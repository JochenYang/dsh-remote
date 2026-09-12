package com.dshremote.app.data

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import org.json.JSONArray
import org.json.JSONObject
import java.util.UUID
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.TimeUnit

/** Sentinel waking a blocked poll the moment the transport fails. */
private fun transportFailedFrame(): JSONObject = JSONObject().put("type", "transport-failed")

/**
 * Remote-initiated socket close with its wire code. The code names the killer:
 * 1012 = relay purged the bridge (host flapped), 1001 = relay restarting,
 * 1006/abnormal = network drop. Surfaced so the UI can say *why*, not just dead.
 */
class StreamClosedException(val code: Int, val reason: String) :
    Exception(if (reason.isNotEmpty()) "连接关闭($code)：$reason" else "连接关闭($code)")

/** Opening snapshot of one session/follow stream: cursor plus newest records. */
data class FollowSnapshot(
    val cursor: Long,
    val records: JSONArray,
    val projections: JSONObject?,
)

/**
 * Minimal client for the gateway multiplexed stream socket
 * (`/api/remote.mux`): open one logical stream, read its opening snapshot,
 * then cancel. Long-lived live-follow reuses the same open frame and keeps
 * consuming `item` frames instead of cancelling.
 */
class FollowClient(private val http: OkHttpClient, private val deviceBase: String) {

    /**
     * Opening snapshot for one follow address. Subagent children additionally
     * prove their mode: `continuable` is tried first, `one-shot` on mismatch.
     */
    suspend fun snapshot(address: JSONObject, maxMessages: Int = 80): FollowSnapshot =
        withContext(Dispatchers.IO) {
            try {
                snapshotWithMode(address, maxMessages)
            } catch (e: RelayError.Transport) {
                val fallback = flippedSubagentAddress(address)
                if (fallback == null || !e.message.orEmpty().contains("mode does not match")) throw e
                snapshotWithMode(fallback, maxMessages)
            }
        }

    private suspend fun snapshotWithMode(address: JSONObject, maxMessages: Int): FollowSnapshot =
        withContext(Dispatchers.IO) {
            val streamId = UUID.randomUUID().toString()
            val open = JSONObject()
                .put("type", "open")
                .put("streamId", streamId)
                .put("endpoint", "session/follow")
                .put(
                    "payload",
                    JSONObject().put(
                        "args",
                        JSONObject().put(
                            "request",
                            JSONObject()
                                .put("address", address)
                                .put("maxMessages", maxMessages)
                                // Include live assistant presentation frames so an
                                // already-running turn shows its current state.
                                .put("assistantStream", true),
                        ),
                    ),
                )
            val frames = LinkedBlockingQueue<JSONObject>()
            var failed: Throwable? = null
            val url = deviceBase.replaceFirst("http", "ws") + "/api/remote.mux"
            val socket = http.newWebSocket(
                Request.Builder().url(url).build(),
                object : WebSocketListener() {
                    override fun onMessage(webSocket: WebSocket, text: String) {
                        try {
                            val frame = JSONObject(text)
                            if (frame.optString("streamId") != streamId) return
                            frames.put(frame)
                        } catch (e: Exception) {
                            failed = e
                            frames.put(transportFailedFrame())
                        }
                    }

                    override fun onClosing(webSocket: WebSocket, code: Int, reason: String) {
                        failed = StreamClosedException(code, reason)
                        frames.put(transportFailedFrame())
                    }

                    override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                        failed = t
                        frames.put(transportFailedFrame())
                    }
                },
            )
            try {
                socket.send(open.toString())
                val deadline = System.currentTimeMillis() + 30_000
                while (true) {
                    val remaining = deadline - System.currentTimeMillis()
                    if (remaining <= 0) throw RelayError.Transport("流超时")
                    // Short polls double as keep-alive checks: any transport
                    // failure surfaces through `failed`, never as silence.
                    val frame = frames.poll(minOf(remaining, 8_000L), TimeUnit.MILLISECONDS)
                    if (frame == null) {
                        failed?.let { throw it }
                        continue
                    }
                    when (frame.optString("type")) {
                        "error" -> {
                            val err = frame.optJSONObject("error")
                            throw RelayError.Transport(err?.optString("message") ?: "流错误")
                        }
                        "end" -> throw RelayError.Transport("流意外结束")
                        "item" -> {
                            val value = frame.optJSONObject("value") ?: continue
                            if (value.optString("type") == "snapshot") {
                                return@withContext FollowSnapshot(
                                    cursor = value.optLong("cursor"),
                                    records = value.optJSONArray("records") ?: JSONArray(),
                                    projections = value.optJSONObject("projections"),
                                )
                            }
                        }
                    }
                    failed?.let { throw it }
                }
            } finally {
                try {
                    socket.send(
                        JSONObject().put("type", "cancel").put("streamId", streamId).toString(),
                    )
                } catch (_: Exception) {
                    // socket already gone; close below is best-effort too
                }
                socket.close(1000, null)
            }
            // The loop above only exits via return or throw; this satisfies
            // the compiler that the try/finally expression has a value.
            throw RelayError.Transport("流意外结束")
        }
}

/** Flip a subagent follow address between its two modes; null when not subagent. */
fun flippedSubagentAddress(address: JSONObject): JSONObject? {
    if (address.optString("kind") != "subagent") return null
    val flipped = JSONObject(address.toString())
    flipped.put("mode", if (address.optString("mode") == "continuable") "one-shot" else "continuable")
    return flipped
}

/** One decoded follow-stream item value (snapshot, event, or assistant frame). */
typealias FollowValue = JSONObject

/**
 * Long-lived follow stream for one session. The caller suspends in [collect]
 * until cancelled; every item value is delivered in arrival order. Cancellation
 * sends `cancel` and closes the socket (structured concurrency friendly).
 */
class LiveFollow(private val http: OkHttpClient, private val deviceBase: String) {

    suspend fun collect(
        endpoint: String,
        request: JSONObject,
        onValue: suspend (FollowValue) -> Unit,
    ): Nothing = withContext(Dispatchers.IO) {
        val streamId = UUID.randomUUID().toString()
        var modeRetried = false
        var gotItem = false
        fun openFor(payload: JSONObject): String = JSONObject()
            .put("type", "open")
            .put("streamId", streamId)
            .put("endpoint", endpoint)
            .put("payload", JSONObject().put("args", payload))
            .toString()
        var currentPayload = JSONObject().put("request", request)
        val frames = LinkedBlockingQueue<JSONObject>()
        var failed: Throwable? = null
        val url = deviceBase.replaceFirst("http", "ws") + "/api/remote.mux"
        val socket = http.newWebSocket(
            Request.Builder().url(url).build(),
            object : WebSocketListener() {
                override fun onMessage(webSocket: WebSocket, text: String) {
                    try {
                        val frame = JSONObject(text)
                        if (frame.optString("streamId") != streamId) return
                        frames.put(frame)
                    } catch (e: Exception) {
                        failed = e
                        frames.put(transportFailedFrame())
                    }
                }

                override fun onClosing(webSocket: WebSocket, code: Int, reason: String) {
                    failed = StreamClosedException(code, reason)
                    frames.put(transportFailedFrame())
                }

                override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                    failed = t
                    frames.put(transportFailedFrame())
                }
            },
        )
        try {
            socket.send(openFor(currentPayload))
            while (true) {
                ensureActive()
                val frame = frames.poll(30, TimeUnit.SECONDS)
                if (frame == null) {
                    failed?.let { throw it }
                    continue
                }
                when (frame.optString("type")) {
                    "error" -> {
                        val message = frame.optJSONObject("error")?.optString("message").orEmpty()
                        // Subagent mode proof happens at open: flip once and reopen.
                        if (!gotItem && !modeRetried && message.contains("mode does not match")) {
                            val address = currentPayload.optJSONObject("request")
                                ?.optJSONObject("address")
                            val fallback = address?.let(::flippedSubagentAddress)
                            if (fallback != null) {
                                modeRetried = true
                                currentPayload.optJSONObject("request")?.put("address", fallback)
                                socket.send(openFor(currentPayload))
                                continue
                            }
                        }
                        throw RelayError.Transport(message.ifEmpty { "流错误" })
                    }
                    "end" -> throw RelayError.Transport("流意外结束")
                    "item" -> {
                        gotItem = true
                        val value = frame.optJSONObject("value") ?: continue
                        onValue(value)
                    }
                }
                failed?.let { throw it }
            }
        } finally {
            try {
                socket.send(
                    JSONObject().put("type", "cancel").put("streamId", streamId).toString(),
                )
            } catch (_: Exception) {
                // socket already gone; close below is best-effort too
            }
            socket.close(1000, null)
        }
        // The loop above only exits via return, throw, or cancellation; this
        // satisfies the compiler that the try/finally expression has a value.
        throw RelayError.Transport("流意外结束")
    }
}
