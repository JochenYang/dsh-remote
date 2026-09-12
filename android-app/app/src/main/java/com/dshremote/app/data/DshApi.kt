package com.dshremote.app.data

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject
import java.util.UUID

/**
 * Host RPC through the relay proxy surface.
 *
 * The relay forwards everything under the device path untouched, so the app
 * speaks the same Typert gateway dialect as the dsh web client: channel
 * `/api`, slash-form endpoints (`session/list`, `session/page`, ...), the
 * `client-request` envelope, and the `server-response` echo. No dsh bearer is
 * needed: the host plugin attaches its own browser-session cookie upstream,
 * exactly like the browser flow.
 */
class DshApi(
    private val http: OkHttpClient,
    private val wsHttp: OkHttpClient,
    private val deviceBase: String,
) {
    private val follow = FollowClient(wsHttp, deviceBase)

    /** Long-lived follow stream factory for the chat screen. */
    fun liveFollow(): LiveFollow = LiveFollow(wsHttp, deviceBase)

    /** User-visible text of one journal event (echo matching included). */
    fun userMessageText(event: JSONObject): String {
        val data = event.optJSONObject("data") ?: return ""
        if (data.optJSONObject("source")?.optString("kind") != "user") return ""
        return joinTextParts(data.optJSONArray("content") ?: return "")
    }
    suspend fun rpc(method: String, args: JSONObject): JSONObject =
        withContext(Dispatchers.IO) {
            val rpcId = "dsh-app-${UUID.randomUUID()}"
            // Gateway dialect: the payload carries exactly one plain-object
            // `args` field, keyed by the endpoint's parameter wire names
            // (`list` takes `_request`, `page` takes `request`, ...).
            val envelope = JSONObject()
                .put("type", "client-request")
                .put("rpcId", rpcId)
                .put("method", method)
                .put("payload", JSONObject().put("args", args))
            val req = Request.Builder()
                .url("$deviceBase/api/$method")
                .post(envelope.toString().toRequestBody("application/json; charset=utf-8".toMediaType()))
                .build()
            val res = http.newCall(req).execute()
            res.use {
                if (it.code == 409) throw HostOfflineException()
                if (!it.isSuccessful) {
                    val relayCause = it.header("X-Dsh-Relay-Error")
                    val detail = if (relayCause != null) " (${it.code}，$relayCause)" else " (${it.code})"
                    throw RelayError.Transport("请求失败$detail")
                }
                val body = JSONObject(it.body?.string().orEmpty())
                if (body.optString("type") != "server-response") {
                    throw RelayError.Transport("响应格式异常")
                }
                if (body.optString("rpcId") != rpcId) {
                    throw RelayError.Transport("响应不匹配，请重试")
                }
                val result = body.optJSONObject("result")
                    ?: throw RelayError.Transport("响应格式异常")
                if (!result.optBoolean("ok")) {
                    val err = result.optJSONObject("error")
                    throw RelayError.Transport(err?.optString("message") ?: "调用失败")
                }
                result.optJSONObject("value") ?: JSONObject()
            }
        }

    suspend fun sessionList(): List<SessionItem> {        val value = rpc("session/list", JSONObject().put("_request", JSONObject()))
        val items = value.optJSONArray("items") ?: JSONArray()
        return List(items.length()) { i ->
            val o = items.getJSONObject(i)
            val projections = o.optJSONObject("projections")?.optJSONObject("values")
            SessionItem(
                sessionId = o.optString("sessionId"),
                title = when (val t = projections?.opt("title")) {
                    is String -> t
                    is JSONObject -> t.optString("text")
                    else -> ""
                },
                running = o.optBoolean("running"),
                preset = projections?.optString("agentPreset").orEmpty(),
                cwd = o.optString("cwd").orEmpty(),
                origin = o.optString("origin").orEmpty(),
                parentSessionId = o.optString("parentSessionId").orEmpty(),
                updatedAt = o.optLong("updatedAt"),
            )
        }.filter { it.sessionId.isNotEmpty() }
    }

    /** Admit one queued prompt; returns the client-minted request identity. */
    suspend fun sendPrompt(sessionId: String, text: String): String {
        val requestId = "dsh-app-req-${UUID.randomUUID()}"
        val content = JSONArray().put(JSONObject().put("type", "text").put("text", text))
        val request = JSONObject()
            .put("requestId", requestId)
            .put("sessionId", sessionId)
            .put("mode", "queue")
            .put("content", content)
        rpc("session/prompt", JSONObject().put("request", request))
        return requestId
    }

    /** Create a fresh ordinary session; returns its identity. */
    suspend fun createSession(): String {
        val value = rpc("session/create", JSONObject().put("request", JSONObject()))
        val id = value.optString("sessionId")
        if (id.isEmpty()) throw RelayError.Transport("创建会话失败")
        return id
    }

    /** Cancel the active turn without dropping the pending inbox. */
    suspend fun cancelTurn(sessionId: String) {
        rpc(
            "session/cancel",
            JSONObject().put("request", JSONObject().put("sessionId", sessionId)),
        )
    }

    /**
     * Latest history via the follow opening snapshot (the only caller-owned
     * way to learn the log cursor). Older pages go through session/page with
     * a cursor taken from a snapshot.
     */
    suspend fun sessionHistory(address: JSONObject, maxMessages: Int = 80): List<TimelineItem> {
        val snapshot = follow.snapshot(address, maxMessages)
        return recordsToTimeline(snapshot.records)
    }

    /** Follow address for one list row: subagent children need their durable parent address. */
    fun addressFor(item: SessionItem): JSONObject =
        if (item.origin == "subagent" && item.parentSessionId.isNotEmpty()) {
            JSONObject()
                .put("kind", "subagent")
                .put("parentSessionId", item.parentSessionId)
                .put("childSessionId", item.sessionId)
                .put("mode", "continuable")
        } else {
            JSONObject().put("kind", "session").put("sessionId", item.sessionId)
        }

    /** Full session/follow open payload for one list row. */
    fun followRequest(item: SessionItem, maxMessages: Int = 80): JSONObject =
        JSONObject()
            .put("address", addressFor(item))
            .put("maxMessages", maxMessages)
            .put("assistantStream", true)

    /**
     * Shared journal parser: snapshot records and live event entries alike.
     * Nothing is silently dropped: unrecognized shapes are reported through
     * [onSkipped] so the UI can surface a count instead of a hole.
     */
    fun recordsToTimeline(
        records: JSONArray,
        onSkipped: (type: String) -> Unit = {},
    ): List<TimelineItem> {
        var out: List<TimelineItem> = emptyList()
        for (i in 0 until records.length()) {
            val record = records.optJSONObject(i) ?: continue
            if (record.optString("type") != "event") {
                onSkipped("record:${record.optString("type")}")
                continue
            }
            val event = record.optJSONObject("event") ?: continue
            out = if (event.optString("type") == "tool/result") {
                parseToolResult(event)?.let { (callId, text, isError) ->
                    mergeToolResult(out, callId, text, isError)
                } ?: run { onSkipped("tool/result?"); out }
            } else {
                val parsed = timelineOf(event, onSkipped)
                out + parsed
            }
        }
        return out
    }

    /** Fold one tool/result into the matching call card (or an orphan card). */
    fun mergeToolResult(
        items: List<TimelineItem>,
        callId: String,
        text: String,
        isError: Boolean,
    ): List<TimelineItem> {
        val index = items.indexOfLast { it is TimelineItem.Tool && it.callId == callId }
        if (index < 0) {
            return items + TimelineItem.Tool(
                name = "工具结果", detail = "", callId = callId, result = text, isError = isError,
            )
        }
        return items.toMutableList().also { mutable ->
            val tool = mutable[index] as TimelineItem.Tool
            mutable[index] = tool.copy(result = text, isError = isError)
        }
    }

    /** Decode one tool/result event: (callId, result text, isError). */
    fun parseToolResult(event: JSONObject): Triple<String, String, Boolean>? {
        val message = event.optJSONObject("data")?.optJSONObject("message") ?: return null
        val callId = message.optJSONObject("source")?.optString("callId").orEmpty()
        if (callId.isEmpty()) return null
        val content = message.optJSONArray("content") ?: JSONArray()
        return Triple(callId, joinTextParts(content), content.optJSONObject(0)?.optBoolean("isError") == true)
    }

    private fun timelineOf(event: JSONObject, onSkipped: (type: String) -> Unit): List<TimelineItem> {
        val data = event.optJSONObject("data") ?: JSONObject()
        val time = event.optLong("time")
        return when (event.optString("type")) {
            "user/message" -> {
                if (data.optJSONObject("source")?.optString("kind") != "user") return emptyList()
                val text = joinTextParts(data.optJSONArray("content") ?: return emptyList())
                if (text.isEmpty()) emptyList() else listOf(TimelineItem.User(text, time))
            }
            "assistant/message" -> {
                val message = data.optJSONObject("message") ?: return emptyList()
                val content = message.optJSONArray("content") ?: JSONArray()
                val out = mutableListOf<TimelineItem>()
                val thinking = joinReasoning(content)
                if (thinking.isNotEmpty()) out += TimelineItem.Reasoning(thinking, live = false, time = time)
                val text = joinTextParts(content)
                if (text.isNotEmpty()) out += TimelineItem.Assistant(text, time)
                out
            }
            // arguments is a raw JSON string on the wire, not an object.
            "tool/call" -> listOf(
                TimelineItem.Tool(
                    name = data.optString("name").ifEmpty { "工具调用" },
                    detail = data.optString("arguments"),
                    callId = data.optString("callId"),
                    time = time,
                ),
            )
            // tool/result is folded into its call card by recordsToTimeline.
            "tool/result" -> emptyList()
            "turn/end" -> {
                val error = data.optJSONObject("reason")?.optString("error").orEmpty()
                if (error.isEmpty()) emptyList() else listOf(TimelineItem.Error(error))
            }
            else -> {
                // Unknown but real: count it AND render a collapsed raw row.
                // Holes are worse than noise — the row identifies the gap.
                val type = event.optString("type")
                if (type !in SILENT_EVENT_TYPES) {
                    onSkipped(type.ifEmpty { "?" })
                    return listOf(
                        TimelineItem.Unknown(type.ifEmpty { "?" }, event.toString().take(500)),
                    )
                }
                emptyList()
            }
        }
    }

    private fun joinReasoning(parts: JSONArray): String = buildString {
        for (i in 0 until parts.length()) {
            val block = parts.optJSONObject(i) ?: continue
            if (block.optString("type") == "reasoning") append(block.optString("text"))
        }
    }

    private fun joinTextParts(parts: JSONArray): String = buildString {
        for (i in 0 until parts.length()) {
            val part = parts.optJSONObject(i) ?: continue
            // Reasoning and non-text parts carry their own `text` key but must
            // never leak into the answer body (they get dedicated cards).
            when (part.optString("type")) {
                "", "text", "text-delta" -> {
                    val text = part.optString("text").ifEmpty { part.optString("text-delta") }
                    if (text.isNotEmpty()) append(text)
                }
            }
        }
    }
}

/** Journal event types that are log-only by design: never rendered, never counted. */
private val SILENT_EVENT_TYPES = setOf(
    "assistant/attempt",
    "turn/start",
    "step/start",
    "step/end",
    "command/run",
    "command/done",
    "compaction/start",
    "compaction/end",
    "compaction/prune",
    "compaction/summary",
    "request/header",
    "request/context",
    "system/message",
    "goal/change",
    "hook/invoked",
    "hook/result",
    "feedback/message-put",
    "feedback/message-delete",
    "feedback/record",
    "session/projection",
    "session/jobs",
    "session/queue",
    "session/title",
    "session/title/lim-request",
    "preset",
    "sandbox/mode",
    "approval/policy",
    "agent/inbox/spliced",
    "llm/retry",
    "llm/retry started",
    "tool/ptc-dispatch",
    "tool/ptc-dispatch-start",
    "web/deepseek-search-llm-request",
)

class HostOfflineException : Exception("主机离线")

data class SessionItem(
    val sessionId: String,
    val title: String,
    val running: Boolean,
    val preset: String,
    val cwd: String,
    val origin: String,
    val parentSessionId: String,
    val updatedAt: Long = 0L,
)

sealed interface TimelineItem {
    data class User(val text: String, val time: Long = 0L) : TimelineItem
    data class Assistant(val text: String, val time: Long = 0L) : TimelineItem
    data class Tool(
        val name: String,
        val detail: String,
        val callId: String = "",
        val result: String = "",
        val isError: Boolean = false,
        val time: Long = 0L,
    ) : TimelineItem
    data class Error(val message: String) : TimelineItem
    data class Reasoning(val text: String, val live: Boolean, val time: Long = 0L, val durationMs: Long? = null) : TimelineItem
    /** Fallback row: unknown journal types render collapsed instead of vanishing. */
    data class Unknown(val type: String, val raw: String) : TimelineItem
}
