package com.dshremote.app.ui.screens

import android.text.format.DateUtils
import android.content.Context
import android.content.Intent
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material.icons.filled.DoneAll
import androidx.compose.material.icons.filled.Build
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.ErrorOutline
import androidx.compose.material.icons.filled.ExpandLess
import androidx.compose.material.icons.filled.ExpandMore
import androidx.compose.material.icons.filled.HourglassEmpty
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Schedule
import androidx.compose.material.icons.filled.Share
import androidx.compose.material.icons.filled.Psychology
import androidx.compose.material.icons.filled.Stop
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.SmallFloatingActionButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.viewmodel.compose.viewModel
import com.dshremote.app.R
import com.dshremote.app.data.DshApi
import com.dshremote.app.data.SessionItem
import com.dshremote.app.data.TimelineItem
import com.dshremote.app.ui.components.AppButton
import com.dshremote.app.ui.components.BannerKind
import com.dshremote.app.ui.components.ButtonSize
import com.dshremote.app.ui.components.ButtonVariant
import com.dshremote.app.ui.components.CodeBlockCard
import com.dshremote.app.ui.components.ConnectionBanner
import com.dshremote.app.ui.components.MarkdownText
import com.dshremote.app.ui.components.MdBlock
import com.dshremote.app.ui.components.SectionCard
import com.dshremote.app.ui.components.rememberMarkwon
import com.dshremote.app.ui.components.splitMarkdown
import com.dshremote.app.ui.theme.MonoFamily
import com.dshremote.app.ui.theme.Radius
import com.dshremote.app.ui.theme.Spacing
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * Chat page: snapshot items plus live follow buffers, composed from the shared
 * visual language (user bubble / plain assistant text / status tool cards).
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ChatScreen(api: DshApi, item: SessionItem, onBack: () -> Unit) {
    val vm: ChatViewModel = viewModel(
        key = item.sessionId,
        factory = ChatViewModelFactory(api, item),
    )
    val listState = rememberLazyListState()
    val reversed = remember(vm.items) { vm.items.asReversed() }
    val context = LocalContext.current

    // reverseLayout pins the entry position to the newest row by construction:
    // no post-layout jump, no timing race. While pinned to the bottom, new
    // rows keep the view there; scrolled-up reading is never yanked.
    LaunchedEffect(
        reversed.size,
        vm.liveText.isNotEmpty(),
        vm.liveThinking.isNotEmpty(),
        vm.pendingEcho != null,
        vm.error != null,
    ) {
        // Pinned follow uses an instant jump: an animated scroll relaunched on
        // every streamed row fights the layout and reads as flicker.
        if (listState.firstVisibleItemIndex <= 1) listState.scrollToItem(0)
    }

    Column(Modifier.fillMaxSize()) {
        TopAppBar(
            title = {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Image(
                        painterResource(R.drawable.ic_brand_mark),
                        contentDescription = null,
                        modifier = Modifier.size(24.dp),
                    )
                    Spacer(Modifier.width(Spacing.s2))
                    Column(Modifier.weight(1f, fill = false)) {
                        Text(
                            item.title.ifEmpty { "会话" },
                            maxLines = 1, overflow = TextOverflow.Ellipsis,
                        )
                        if (item.origin == "subagent") {
                            Text(
                                "子代理会话",
                                style = MaterialTheme.typography.labelSmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                    }
                }
            },
            navigationIcon = {
                IconButton(onClick = onBack) {
                    Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "返回")
                }
            },
            actions = {
                IconButton(onClick = { shareTranscript(context, item.title.ifEmpty { "会话" }, vm.items) }) {
                    Icon(Icons.Filled.Share, contentDescription = "分享对话")
                }
            },
        )
        HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
        MetaBar(
            model = vm.currentModel,
            live = vm.error == null && vm.reconnectNote == null,
        )
        if (vm.queueNote != null) {
            Surface(
                color = MaterialTheme.colorScheme.surfaceContainerLow,
                modifier = Modifier.fillMaxWidth(),
            ) {
                Row(
                    Modifier.fillMaxWidth().padding(horizontal = Spacing.s4, vertical = Spacing.s2),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Icon(Icons.Filled.HourglassEmpty, contentDescription = null)
                    Spacer(Modifier.width(Spacing.s2))
                    Text(vm.queueNote!!, style = MaterialTheme.typography.labelSmall)
                }
            }
        }
        if (vm.reconnectNote != null) {
            Surface(
                color = MaterialTheme.colorScheme.surfaceContainerLow,
                modifier = Modifier.fillMaxWidth(),
            ) {
                Row(
                    Modifier.fillMaxWidth().padding(horizontal = Spacing.s4, vertical = Spacing.s2),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Icon(Icons.Filled.Refresh, contentDescription = null)
                    Spacer(Modifier.width(Spacing.s2))
                    Text(
                        vm.reconnectNote!!,
                        style = MaterialTheme.typography.labelSmall,
                        modifier = Modifier.weight(1f),
                    )
                    AppButton("立即重试", onClick = { vm.retry() }, variant = ButtonVariant.Ghost, size = ButtonSize.S)
                }
            }
        }
        if (vm.loading) {
            Column(
                Modifier.weight(1f).fillMaxWidth(),
                verticalArrangement = Arrangement.Center,
                horizontalAlignment = Alignment.CenterHorizontally,
            ) { CircularProgressIndicator() }
        } else {
            LazyColumn(
                modifier = Modifier.weight(1f).fillMaxWidth(),
                state = listState,
                reverseLayout = true,
            ) {
                // Code order is newest-first; reverseLayout renders it bottom-up.
                if (vm.error != null) {
                    item(key = "error") {
                        Column(
                            Modifier.fillMaxWidth().padding(Spacing.s4),
                            horizontalAlignment = Alignment.CenterHorizontally,
                        ) {
                            Text(
                                vm.error!!,
                                color = MaterialTheme.colorScheme.error,
                                style = MaterialTheme.typography.labelSmall,
                            )
                            Spacer(Modifier.height(Spacing.s2))
                            Row {
                                AppButton("重试", onClick = { vm.retry() }, variant = ButtonVariant.Secondary)
                                Spacer(Modifier.width(Spacing.s2))
                                AppButton("关闭", onClick = { vm.dismissError() }, variant = ButtonVariant.Ghost)
                            }
                        }
                    }
                }
                if (vm.liveText.isNotEmpty()) {
                    item(key = "live-text") {
                        StreamingRow(text = vm.liveText)
                    }
                }
                if (vm.liveThinking.isNotEmpty()) {
                    item(key = "live-thinking") {
                        ReasoningLine(text = vm.liveThinking, live = true)
                    }
                }
                if (vm.pendingEcho != null) {
                    item(key = "echo") {
                        val echo = vm.pendingEcho!!
                        Column(
                            Modifier.fillMaxWidth().padding(horizontal = Spacing.s4, vertical = Spacing.s2),
                            horizontalAlignment = Alignment.End,
                        ) {
                            UserBubble(echo.text)
                            ReceiptFooter(time = echo.sentAt, sent = false)
                        }
                    }
                }
                itemsIndexed(reversed, key = { index, row -> "$index-${rowKey(row)}" }) { index, row ->
                    TimelineRow(row)
                    // Reverse layout renders code-later rows visually above:
                    // the divider sits above a day's oldest message.
                    val day = rowDay(row)
                    val olderDay = reversed.getOrNull(index + 1)?.let(::rowDay)
                    if (day.isNotEmpty() && day != olderDay) DayDivider(day)
                }
            }
        }
        if (vm.error == "主机离线") {
            ConnectionBanner(BannerKind.Offline, "主机离线：重连后自动恢复")
        }
        // Temporary diagnostics, now a designed capsule; remove before release.
        TelemetryCapsule(
            alive = vm.error == null && vm.reconnectNote == null,
            skip = vm.skippedCount,
            raw = vm.debugLine,
        )
        Composer(
            running = vm.running,
            enabled = !vm.loading,
            onSend = { vm.send(it) },
            onCancel = { vm.cancel() },
        )
    }
}

/** Centered day pill separating message days; full-round shape is reserved for pills. */
@Composable
private fun DayDivider(label: String) {
    Box(
        Modifier.fillMaxWidth().padding(vertical = Spacing.s2),
        contentAlignment = Alignment.Center,
    ) {
        Surface(
            color = MaterialTheme.colorScheme.surfaceContainerLow,
            shape = RoundedCornerShape(percent = 50),
        ) {
            Text(
                label,
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(horizontal = Spacing.s3, vertical = Spacing.s1),
            )
        }
    }
}

private fun rowDay(item: TimelineItem): String = when (item) {
    is TimelineItem.User -> dayLabel(item.time)
    is TimelineItem.Assistant -> dayLabel(item.time)
    is TimelineItem.Tool -> dayLabel(item.time)
    is TimelineItem.Reasoning -> dayLabel(item.time)
    else -> ""
}

private fun dayLabel(time: Long): String {
    if (time <= 0) return ""
    return when {
        DateUtils.isToday(time) -> "今天"
        DateUtils.isToday(time + DateUtils.DAY_IN_MILLIS) -> "昨天"
        else -> SimpleDateFormat("M月d日", Locale.CHINA).format(Date(time))
    }
}

/** Model pill plus live sync state, mirroring the desktop status bar. */
@Composable
private fun MetaBar(model: String?, live: Boolean) {
    Row(
        Modifier.fillMaxWidth().padding(horizontal = Spacing.s4, vertical = Spacing.s1),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (model != null) {
            Surface(
                color = MaterialTheme.colorScheme.surfaceContainerLow,
                shape = CircleShape,
            ) {
                Text(
                    model,
                    style = MaterialTheme.typography.labelSmall.copy(fontFamily = MonoFamily),
                    color = MaterialTheme.colorScheme.onSurface,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.padding(horizontal = Spacing.s2, vertical = Spacing.s1)
                        .weight(1f, fill = false),
                )
            }
            Spacer(Modifier.width(Spacing.s2))
        }
        Box(
            Modifier.size(8.dp).background(
                if (live) MaterialTheme.colorScheme.tertiary
                else MaterialTheme.colorScheme.error,
                CircleShape,
            ),
        )
        Spacer(Modifier.width(Spacing.s1))
        Text(
            if (live) "实时同步中" else "已断开",
            style = MaterialTheme.typography.labelSmall,
            color = if (live) MaterialTheme.colorScheme.tertiary
            else MaterialTheme.colorScheme.error,
        )
    }
}

/** Plain-text transcript share; structure mirrors the timeline, no raw dumps. */
private fun shareTranscript(context: Context, title: String, items: List<TimelineItem>) {
    val body = buildString {
        appendLine("# $title")
        for (item in items) {
            when (item) {
                is TimelineItem.User -> {
                    appendLine()
                    appendLine("你：${item.text}")
                }
                is TimelineItem.Assistant -> {
                    appendLine()
                    append(item.text)
                }
                is TimelineItem.Reasoning -> {
                    appendLine()
                    appendLine("【思考】${item.text}")
                }
                is TimelineItem.Tool -> {
                    appendLine()
                    appendLine("[工具 ${item.name}]${item.result.ifEmpty { item.detail }}")
                }
                is TimelineItem.Error -> {
                    appendLine()
                    appendLine("出错：${item.message}")
                }
                is TimelineItem.Unknown -> {}
            }
        }
    }
    val intent = Intent(Intent.ACTION_SEND).apply {
        type = "text/plain"
        putExtra(Intent.EXTRA_TEXT, body.toString())
    }
    context.startActivity(Intent.createChooser(intent, "分享对话"))
}

private fun formatClock(time: Long): String {
    if (time <= 0) return ""
    return SimpleDateFormat("HH:mm", Locale.CHINA).format(Date(time))
}

private fun formatDuration(ms: Long): String =
    if (ms < 10_000) "%.1fs".format(Locale.US, ms / 1000f) else "${ms / 1000}s"

/** Field telemetry capsule: live pills plus a collapsible raw inspector line. */
@Composable
private fun TelemetryCapsule(alive: Boolean, skip: Int, raw: String) {
    var expanded by remember { mutableStateOf(false) }
    Column(
        Modifier.fillMaxWidth()
            .padding(horizontal = Spacing.s4, vertical = Spacing.s1),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Box(
                Modifier.size(8.dp).background(
                    if (alive) MaterialTheme.colorScheme.tertiary
                    else MaterialTheme.colorScheme.error,
                    CircleShape,
                ),
            )
            Spacer(Modifier.width(Spacing.s1))
            Text(
                if (alive) "实时同步中" else "已断开",
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Spacer(Modifier.width(Spacing.s2))
            Text(
                "skip=$skip",
                style = MaterialTheme.typography.labelSmall.copy(fontFamily = MonoFamily),
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Spacer(Modifier.weight(1f))
            Text(
                "详细日志",
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.primary,
                modifier = Modifier.clickable { expanded = !expanded },
            )
        }
        if (expanded) {
            Text(
                raw,
                style = MaterialTheme.typography.labelSmall.copy(fontFamily = MonoFamily),
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.fillMaxWidth().padding(top = Spacing.s1),
            )
        }
    }
}

private fun rowKey(item: TimelineItem): String = when (item) {    is TimelineItem.User -> "u-${item.text.hashCode()}"
    is TimelineItem.Assistant -> "a-${item.text.hashCode()}"
    is TimelineItem.Tool -> "t-${item.callId.ifEmpty { item.name }}"
    is TimelineItem.Error -> "e-${item.message.hashCode()}"
    is TimelineItem.Reasoning -> "r-${item.text.hashCode()}"
    is TimelineItem.Unknown -> "x-${item.type}-${item.raw.hashCode()}"
}

@Composable
private fun TimelineRow(item: TimelineItem) {
    when (item) {
        is TimelineItem.User -> Column(
            Modifier.fillMaxWidth().padding(horizontal = Spacing.s4, vertical = Spacing.s2),
            horizontalAlignment = Alignment.End,
        ) {
            UserBubble(item.text)
            ReceiptFooter(time = item.time, sent = true)
        }
        is TimelineItem.Assistant -> {
            val markwon = rememberMarkwon()
            val blocks = remember(item.text) { splitMarkdown(item.text) }
            Column(
                Modifier.fillMaxWidth().padding(horizontal = Spacing.s4, vertical = Spacing.s2),
            ) {
                var sectionIndex = 0
                blocks.forEachIndexed { index, block ->
                    when (block) {
                        is MdBlock.Prose -> MarkdownText(
                            markwon, block.markdown, Modifier.fillMaxWidth(),
                        )
                        is MdBlock.Section -> {
                            SectionCard(
                                title = block.title,
                                markwon = markwon,
                                markdown = block.markdown,
                                primaryRail = sectionIndex % 2 == 0,
                                modifier = Modifier.fillMaxWidth(),
                            )
                            sectionIndex++
                        }
                        is MdBlock.Code -> CodeBlockCard(
                            language = block.language,
                            code = block.code,
                            modifier = Modifier.fillMaxWidth(),
                        )
                    }
                    if (index < blocks.lastIndex) Spacer(Modifier.height(Spacing.s2))
                }
            }
        }
        is TimelineItem.Reasoning -> ReasoningLine(text = item.text, live = item.live, durationMs = item.durationMs)
        is TimelineItem.Tool -> ToolLine(item)
        is TimelineItem.Unknown -> UnknownRow(item)
        is TimelineItem.Error -> Text(
            item.message, color = MaterialTheme.colorScheme.error,
            style = MaterialTheme.typography.labelSmall,
            modifier = Modifier.fillMaxWidth().padding(Spacing.s4),
        )
    }
}

/** Timestamp plus delivery receipt: clock while echoing, ticks once logged. */
@Composable
private fun ReceiptFooter(time: Long, sent: Boolean) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        Text(
            formatClock(time),
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Spacer(Modifier.width(2.dp))
        Icon(
            if (sent) Icons.Filled.DoneAll else Icons.Filled.Schedule,
            contentDescription = null,
            tint = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.size(12.dp),
        )
    }
}
/** Right-aligned primary bubble; the shape (not color alone) marks ownership. */
@Composable
private fun UserBubble(text: String) {
    Surface(
        color = MaterialTheme.colorScheme.primary,
        contentColor = MaterialTheme.colorScheme.onPrimary,
        shape = RoundedCornerShape(topStart = Radius.card, topEnd = Radius.card, bottomStart = Radius.card, bottomEnd = Radius.button),
        modifier = Modifier.widthIn(max = 320.dp),
    ) {
        Text(text, modifier = Modifier.padding(Spacing.s3))
    }
}

/** Fallback for unrecognized journal events: one collapsed line, tap for raw. */
@Composable
private fun UnknownRow(item: TimelineItem.Unknown) {
    var expanded by remember { mutableStateOf(false) }
    Column(
        Modifier.fillMaxWidth().padding(horizontal = Spacing.s4, vertical = Spacing.s1)
            .clickable { expanded = !expanded },
    ) {
        Text(
            "未识别事件 ${item.type}",
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        if (expanded) {
            Text(
                item.raw,
                style = MaterialTheme.typography.labelSmall.copy(fontFamily = MonoFamily),
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.fillMaxWidth(),
            )
        }
    }
}

/** Status-line row in the desktop idiom: icon · label · summary, one dense line. */
@Composable
private fun StatusRow(
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    iconTint: androidx.compose.ui.graphics.Color,
    label: String,
    summary: String,
    summaryColor: androidx.compose.ui.graphics.Color,
    maxSummaryLines: Int,
    onClick: (() -> Unit)?,
) {
    val row: @Composable () -> Unit = {
        Row(
            Modifier.fillMaxWidth().padding(horizontal = Spacing.s4, vertical = Spacing.s1)
                .then(if (onClick != null) Modifier.clickable { onClick() } else Modifier),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon(icon, contentDescription = null, tint = iconTint, modifier = Modifier.size(16.dp))
            Spacer(Modifier.width(Spacing.s2))
            Text(
                label,
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurface,
            )
            Spacer(Modifier.width(Spacing.s2))
            Text(
                summary,
                style = MaterialTheme.typography.labelSmall,
                color = summaryColor,
                maxLines = maxSummaryLines,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.weight(1f),
            )
        }
    }
    row()
}

/** Reasoning as a status line; tap toggles the full mono block underneath. */
@Composable
private fun ReasoningLine(text: String, live: Boolean, durationMs: Long? = null) {
    var expanded by remember { mutableStateOf(false) }
    Column(Modifier.fillMaxWidth()) {
        StatusRow(
            icon = Icons.Filled.Psychology,
            iconTint = MaterialTheme.colorScheme.onSurfaceVariant,
            label = "思考",
            summary = when {
                live -> "…"
                durationMs != null -> "用时 ${formatDuration(durationMs)}"
                else -> text.replace('\n', ' ')
            },
            summaryColor = MaterialTheme.colorScheme.onSurfaceVariant,
            maxSummaryLines = if (expanded) Int.MAX_VALUE else 1,
            onClick = { expanded = !expanded },
        )
        if (expanded && !live) {
            Text(
                text,
                style = MaterialTheme.typography.labelSmall.copy(fontFamily = MonoFamily),
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.fillMaxWidth().padding(start = Spacing.s6, end = Spacing.s4),
            )
        }
    }
}

@Composable
private fun StreamingRow(text: String) {
    Row(
        Modifier.fillMaxWidth().padding(horizontal = Spacing.s4, vertical = Spacing.s1),
        verticalAlignment = Alignment.Bottom,
    ) {
        Text(
            text,
            style = MaterialTheme.typography.bodyLarge,
            modifier = Modifier.weight(1f, fill = false),
        )
        Spacer(Modifier.width(4.dp))
        // Live indicator: a steady caret, not a blink. Its presence (not its
        // color alone) carries the "generating" state next to the text.
        Box(
            Modifier
                .width(2.dp)
                .height(18.dp)
                .background(MaterialTheme.colorScheme.primary),
        )
    }
}

/** Tool call as a status line; args + folded result live under the expand. */
@Composable
private fun ToolLine(item: TimelineItem.Tool) {
    var expanded by remember { mutableStateOf(false) }
    val statusIcon = when {
        item.isError -> Icons.Filled.ErrorOutline
        item.result.isNotEmpty() -> Icons.Filled.CheckCircle
        else -> Icons.Filled.Build
    }
    val iconTint = if (item.isError) MaterialTheme.colorScheme.error
    else MaterialTheme.colorScheme.onSurfaceVariant
    Column(Modifier.fillMaxWidth()) {
        StatusRow(
            icon = statusIcon,
            iconTint = iconTint,
            label = if (item.isError) "工具调用" else "工具调用",
            summary = item.result.ifEmpty { item.detail.replace('\n', ' ') },
            summaryColor = if (item.isError) MaterialTheme.colorScheme.error
            else MaterialTheme.colorScheme.onSurfaceVariant,
            maxSummaryLines = if (expanded) Int.MAX_VALUE else 1,
            onClick = { expanded = !expanded },
        )
        if (expanded) {
            if (item.detail.isNotEmpty()) {
                Text(
                    item.detail,
                    style = MaterialTheme.typography.labelSmall.copy(fontFamily = MonoFamily),
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    maxLines = 8, overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.fillMaxWidth().padding(start = Spacing.s6, end = Spacing.s4),
                )
            }
            if (item.result.isNotEmpty()) {
                Text(
                    item.result,
                    style = MaterialTheme.typography.labelSmall.copy(fontFamily = MonoFamily),
                    color = if (item.isError) MaterialTheme.colorScheme.error
                    else MaterialTheme.colorScheme.onSurfaceVariant,
                    maxLines = 12, overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.fillMaxWidth().padding(start = Spacing.s6, end = Spacing.s4),
                )
            }
        }
    }
}

@Composable
private fun Composer(
    running: Boolean,
    enabled: Boolean,
    onSend: (String) -> Unit,
    onCancel: () -> Unit,
) {
    var draft by remember { mutableStateOf("") }
    Row(
        Modifier.fillMaxWidth().padding(Spacing.s4),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        OutlinedTextField(
            value = draft,
            onValueChange = { draft = it },
            enabled = enabled && !running,
            readOnly = running,
            placeholder = { Text(if (running) "正在生成…" else "输入消息") },
            modifier = Modifier.weight(1f),
            shape = RoundedCornerShape(24.dp),
            maxLines = 5,
        )
        Spacer(Modifier.width(Spacing.s2))
        if (running) {
            SmallFloatingActionButton(
                onClick = onCancel,
                containerColor = MaterialTheme.colorScheme.error,
                contentColor = MaterialTheme.colorScheme.onError,
            ) {
                Icon(Icons.Filled.Stop, contentDescription = "停止生成")
            }
        } else {
            SmallFloatingActionButton(
                // No `enabled` param on M3 FABs: guard inside, vm.send also
                // ignores blank text, so a stray tap is a safe no-op.
                onClick = { if (enabled && draft.isNotBlank()) { onSend(draft); draft = "" } },
            ) {
                Icon(Icons.AutoMirrored.Filled.Send, contentDescription = "发送")
            }
        }
    }
}
