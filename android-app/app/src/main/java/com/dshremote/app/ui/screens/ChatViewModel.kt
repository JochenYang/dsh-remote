package com.dshremote.app.ui.screens

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import com.dshremote.app.data.DshApi
import com.dshremote.app.data.HostOfflineException
import com.dshremote.app.data.SessionItem
import com.dshremote.app.data.StreamClosedException
import com.dshremote.app.data.TimelineItem
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
/**
 * Chat screen state: snapshot items plus live follow buffers. The live stream
 * is the single source of truth after the opening snapshot — no local message
 * assembly, no reload-on-turn-end. A locally echoed prompt is retired when the
 * matching journal user/message arrives.
 */
/** Locally echoed prompt awaiting its journal arrival (receipts: clock → done_all). */
data class PendingEcho(val text: String, val sentAt: Long)

class ChatViewModel(private val api: DshApi, val item: SessionItem) : ViewModel() {
    val sessionId: String = item.sessionId
    var items by mutableStateOf<List<TimelineItem>>(emptyList())
        private set
    var liveText by mutableStateOf("")
        private set
    var liveThinking by mutableStateOf("")
        private set
    var thinkingLive by mutableStateOf(false)
        private set
    var running by mutableStateOf(false)
        private set
    var pendingEcho by mutableStateOf<PendingEcho?>(null)
        private set
    var loading by mutableStateOf(true)
        private set
    var error by mutableStateOf<String?>(null)
        private set
    /** Slim queue banner text from the control stream; null when nothing waits. */
    var queueNote by mutableStateOf<String?>(null)
        private set
    /** Slim auto-reconnect banner; null while the follow stream is healthy. */
    var reconnectNote by mutableStateOf<String?>(null)
        private set
    var skippedCount by mutableStateOf(0)
        private set
    /** Current model display name from snapshot projections, when advertised. */
    var currentModel by mutableStateOf<String?>(null)
        private set
    // Temporary stream diagnostics (remove before release): proves whether the
    // follow socket is alive and what it last delivered.
    var debugLine by mutableStateOf("follow: connecting…")
        private set
    private var frameCount = 0

    private var followJob: Job? = null
    private var controlJob: Job? = null
    private var followAttempt = 0
    private var thinkingStartMs = 0L

    init {
        openLive()
    }

    fun send(text: String) {
        val clean = text.trim()
        if (clean.isEmpty() || running) return
        viewModelScope.launch {
            error = null
            // Show the local echo immediately; the journal arrival retires it.
            pendingEcho = PendingEcho(clean, System.currentTimeMillis())
            running = true
            try {
                withContext(Dispatchers.IO) { api.sendPrompt(sessionId, clean) }
            } catch (e: Exception) {
                pendingEcho = null
                running = false
                error = e.message ?: "发送失败"
            }
        }
    }

    fun cancel() {
        viewModelScope.launch {
            try {
                withContext(Dispatchers.IO) { api.cancelTurn(sessionId) }
            } catch (e: Exception) {
                error = e.message ?: "取消失败"
            }
        }
    }

    fun retry() {
        error = null
        openLive()
    }

    fun dismissError() {
        error = null
    }

    private fun openLive() {
        followJob?.cancel()
        controlJob?.cancel()
        loading = true
        reconnectNote = null
        followJob = viewModelScope.launch(Dispatchers.IO) {
            followAttempt = 0
            while (true) {
                try {
                    api.liveFollow().collect("session/follow", api.followRequest(item)) { value ->
                        withContext(Dispatchers.Main) { handleValue(value) }
                    }
                    break // collect only exits via cancellation (Nothing)
                } catch (e: CancellationException) {
                    throw e
                } catch (e: Exception) {
                    followAttempt++
                    // Name the killer from the wire close code: 1012 means the
                    // relay purged our bridge because the host flapped.
                    val closed = e as? StreamClosedException
                    val cause = when {
                        e is HostOfflineException -> "主机离线"
                        closed != null && closed.code == 1012 -> "主机闪断"
                        else -> e.message ?: "连接中断"
                    }
                    val waitSec = minOf(1 shl minOf(followAttempt - 1, 5), 30)
                    withContext(Dispatchers.Main) {
                        if (followAttempt == 1) error = cause
                        reconnectNote = "连接中断 · ${waitSec}s 后自动重连"
                        debugLine = "follow: retry#$followAttempt · $cause" +
                            (if (closed != null) " (${closed.code})" else "") +
                            " · skip=$skippedCount"
                        running = false
                        loading = false
                    }
                    delay(waitSec * 1000L)
                    withContext(Dispatchers.Main) { reconnectNote = null }
                }
            }
        }
        // Control stream is advisory: queue states only, never fatal.
        controlJob = viewModelScope.launch(Dispatchers.IO) {
            try {
                api.liveFollow().collect("session/control", JSONObject()) { value ->
                    withContext(Dispatchers.Main) { handleControl(value) }
                }
            } catch (_: Exception) {
                // Follow carries the fatal signal; control just goes quiet.
            }
        }
    }

    private fun handleControl(value: JSONObject) {
        when (value.optString("type")) {
            "baseline" -> applyQueue(
                value.optJSONObject("value")?.optJSONObject("queues")?.optJSONArray(sessionId),
            )
            "queue" -> if (value.optString("sessionId") == sessionId) {
                applyQueue(value.optJSONArray("items"))
            }
        }
    }

    private fun applyQueue(items: JSONArray?) {
        if (items == null) {
            queueNote = null
            return
        }
        var waiting = 0
        for (i in 0 until items.length()) {
            if (items.optJSONObject(i)?.optString("placement") == "queued") waiting++
        }
        queueNote = if (waiting > 0) "排队中 · $waiting 条等待执行" else null
    }

    private fun handleValue(value: JSONObject) {
        frameCount++
        debugLine = "follow: live · frames=$frameCount · last=${value.optString("type")} · skip=$skippedCount"
        when (value.optString("type")) {
            "snapshot" -> {
                followAttempt = 0
                error = null
                reconnectNote = null
                currentModel = extractModelName(value.optJSONObject("projections"))
                items = api.recordsToTimeline(value.optJSONArray("records") ?: JSONArray()) {
                    skippedCount++
                }
                liveText = ""
                liveThinking = ""
                thinkingLive = false
                running = value.optJSONObject("assistantStream")
                    ?.optJSONObject("activeAttempt") != null
                loading = false
            }
            "event" -> handleEvent(value.optJSONObject("event") ?: return)
            "assistant-stream" -> handleAssistantFrame(value.optJSONObject("frame") ?: return)
        }
    }

    private fun handleEvent(event: JSONObject) {
        loading = false
        when (event.optString("type")) {
            "user/message" -> {
                val text = api.userMessageText(event)
                if (text.isEmpty()) return
                // Retire the local echo AND materialize the journal row: the
                // opening snapshot predates this message, so nothing else has it.
                if (pendingEcho != null && text == pendingEcho?.text) pendingEcho = null
                items = items + TimelineItem.User(text, System.currentTimeMillis())
            }
            "turn/end" -> {
                running = false
                flushLive()
                val errorText = event.optJSONObject("data")
                    ?.optJSONObject("reason")?.optString("error").orEmpty()
                if (errorText.isNotEmpty()) items = items + TimelineItem.Error(errorText)
            }
            "tool/result" -> {
                api.parseToolResult(event)?.let { (callId, text, isError) ->
                    items = api.mergeToolResult(items, callId, text, isError)
                }
            }
            else -> {
                val wrapped = JSONArray()
                    .put(JSONObject().put("type", "event").put("event", event))
                val parsed = api.recordsToTimeline(wrapped) { skippedCount++ }
                if (parsed.isNotEmpty()) {
                    // A committed assistant/reasoning row supersedes the live
                    // buffers (same content, canonical form): drop them instead
                    // of appending, otherwise every streamed reply doubles.
                    val superseded = parsed.any {
                        it is TimelineItem.Assistant || it is TimelineItem.Reasoning
                    }
                    if (superseded) {
                        liveText = ""
                        liveThinking = ""
                        thinkingLive = false
                    } else {
                        flushLive()
                    }
                    items = items + parsed
                } else {
                    skippedCount++
                }
            }
        }
    }

    private fun handleAssistantFrame(frame: JSONObject) {
        loading = false
        when (frame.optString("type")) {
            "start" -> {
                flushLive()
                running = true
            }
            "chunk" -> {
                val chunk = frame.optJSONObject("chunk") ?: return
                when (chunk.optString("type")) {
                    "text-delta" -> liveText += chunk.optString("text")
                    "reasoning-delta" -> {
                        if (liveThinking.isEmpty()) thinkingStartMs = System.currentTimeMillis()
                        liveThinking += chunk.optString("text")
                        thinkingLive = true
                    }
                    "block-end" -> {
                        // Committed reasoning/text blocks inside a live turn:
                        // flush so the UI mirrors the desktop's step structure.
                        val block = chunk.optJSONObject("block")
                        if (block?.optString("type") == "reasoning") {
                            flushLive()
                        }
                    }
                }
            }
            "end" -> thinkingLive = false
        }
    }

    private fun flushLive() {
        val now = System.currentTimeMillis()
        if (liveThinking.isNotEmpty()) {
            val duration = if (thinkingStartMs > 0) now - thinkingStartMs else null
            items = items + TimelineItem.Reasoning(liveThinking, live = false, time = now, durationMs = duration)
            liveThinking = ""
            thinkingStartMs = 0L
        }
        if (liveText.isNotEmpty()) {
            items = items + TimelineItem.Assistant(liveText, time = now)
            liveText = ""
        }
        thinkingLive = false
    }

    override fun onCleared() {
        followJob?.cancel()
        controlJob?.cancel()
    }

    /**
     * Best-effort model display name from projection values. Shapes vary by
     * harness version, so every level is optional — unknown means hidden pill.
     */
    private fun extractModelName(projections: JSONObject?): String? {
        val values = projections?.optJSONObject("values") ?: return null
        val selection = values.optJSONObject("modelSelection")
        if (selection != null) {
            selection.optJSONObject("next")?.optString("model")?.takeIf { it.isNotEmpty() }?.let { return it }
            selection.optJSONObject("lastUsed")?.optString("model")?.takeIf { it.isNotEmpty() }?.let { return it }
        }
        return values.optString("model").takeIf { it.isNotEmpty() }
    }
}

class ChatViewModelFactory(
    private val api: DshApi,
    private val item: SessionItem,
) : ViewModelProvider.Factory {
    @Suppress("UNCHECKED_CAST")
    override fun <T : ViewModel> create(modelClass: Class<T>): T {
        return ChatViewModel(api, item) as T
    }
}
