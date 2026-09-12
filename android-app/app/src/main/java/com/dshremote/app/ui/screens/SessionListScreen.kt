package com.dshremote.app.ui.screens

import android.text.format.DateUtils
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
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
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Circle
import androidx.compose.material.icons.filled.ExpandLess
import androidx.compose.material.icons.filled.ExpandMore
import androidx.compose.material.icons.filled.Inbox
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.SearchOff
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExtendedFloatingActionButton
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextField
import androidx.compose.material3.TextFieldDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.dshremote.app.R
import com.dshremote.app.data.DshApi
import com.dshremote.app.data.HostOfflineException
import com.dshremote.app.data.SessionItem
import com.dshremote.app.ui.components.AppButton
import com.dshremote.app.ui.components.BannerKind
import com.dshremote.app.ui.components.ButtonVariant
import com.dshremote.app.ui.components.ConnectionBanner
import com.dshremote.app.ui.theme.Radius
import com.dshremote.app.ui.theme.Spacing
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import kotlinx.coroutines.launch

private const val SUBAGENT_SECTION = "§subagents"

private sealed interface SessionsState {
    data object Loading : SessionsState
    data class Ready(val items: List<SessionItem>) : SessionsState
    data object HostOffline : SessionsState
    data class Failed(val message: String) : SessionsState
}

/**
 * Session list: flat rows grouped by recency day, typography hierarchy only
 * (no cards). Running is the single primary-colored state; everything else
 * stays neutral. Unpairing lives in Settings — the header keeps entry points.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SessionListScreen(
    api: DshApi,
    insecureHttp: Boolean,
    onOpen: (SessionItem) -> Unit,
    onSettings: () -> Unit,
) {
    var state by remember { mutableStateOf<SessionsState>(SessionsState.Loading) }
    var nonce by remember { mutableStateOf(0) }
    var creating by remember { mutableStateOf(false) }
    var createError by remember { mutableStateOf<String?>(null) }
    var query by remember { mutableStateOf("") }
    var collapsed by rememberSaveable { mutableStateOf(setOf(SUBAGENT_SECTION)) }
    val scope = rememberCoroutineScope()

    LaunchedEffect(nonce) {
        state = try {
            SessionsState.Ready(api.sessionList())
        } catch (e: HostOfflineException) {
            SessionsState.HostOffline
        } catch (e: Exception) {
            SessionsState.Failed(e.message?.takeIf { it.isNotBlank() } ?: "加载失败 (${e.javaClass.simpleName})")
        }
    }

    Box(Modifier.fillMaxSize()) {
        Column(Modifier.fillMaxSize().statusBarsPadding()) {
            ListHeader(
                runningCount = (state as? SessionsState.Ready)?.items?.count { it.running } ?: 0,
                onRefresh = { nonce++ },
                onSettings = onSettings,
            )
            HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
            if (insecureHttp) {
                ConnectionBanner(BannerKind.Insecure, "当前为未加密连接，仅建议在可信局域网使用")
            }
            when (val s = state) {
                SessionsState.Loading -> Column(
                    Modifier.fillMaxSize().padding(Spacing.s5),
                    verticalArrangement = Arrangement.Center,
                    horizontalAlignment = Alignment.CenterHorizontally,
                ) { CircularProgressIndicator() }

                SessionsState.HostOffline -> Column(
                    Modifier.fillMaxSize().padding(Spacing.s5),
                    verticalArrangement = Arrangement.Center,
                    horizontalAlignment = Alignment.CenterHorizontally,
                ) {
                    ConnectionBanner(
                        BannerKind.Offline, "主机离线：检查电脑侧 dsh-remote 是否在线",
                        onRetry = { nonce++ },
                    )
                }

                is SessionsState.Failed -> Column(
                    Modifier.fillMaxSize().padding(Spacing.s5),
                    verticalArrangement = Arrangement.Center,
                    horizontalAlignment = Alignment.CenterHorizontally,
                ) {
                    Text(s.message, color = MaterialTheme.colorScheme.error)
                    Spacer(Modifier.height(Spacing.s3))
                    AppButton("重试", onClick = { nonce++ }, variant = ButtonVariant.Secondary)
                }

                is SessionsState.Ready -> if (s.items.isEmpty()) {
                    EmptySessions()
                } else {
                    SearchDock(
                        query = query,
                        onQuery = { query = it },
                    )
                    val filtered = remember(s.items, query) {
                        if (query.isBlank()) s.items
                        else s.items.filter {
                            it.title.contains(query, ignoreCase = true) ||
                                it.cwd.contains(query, ignoreCase = true)
                        }
                    }
                    if (filtered.isEmpty()) {
                        SearchEmpty()
                    } else {
                        // Subagents are background workers, not conversations: they
                        // live in one collapsed section at the bottom instead of
                        // scattering through the list (desktop-app idiom).
                        val mains = filtered.filter { it.origin != "subagent" }
                        val subs = filtered.filter { it.origin == "subagent" }
                        val grouped = remember(mains) { groupByFolder(mains) }
                        LazyColumn(Modifier.fillMaxSize()) {
                            grouped.forEach { (folder, rows) ->
                                item(key = "header-$folder") {
                                    ProjectHeader(
                                        folder = folder,
                                        count = rows.size,
                                        running = rows.count { it.running },
                                        collapsed = collapsed.contains(folder),
                                        onToggle = {
                                            collapsed = if (collapsed.contains(folder)) collapsed - folder
                                            else collapsed + folder
                                        },
                                    )
                                }
                                if (!collapsed.contains(folder)) {
                                    itemsIndexed(rows, key = { _, it -> it.sessionId }) { index, item ->
                                        SessionRow(item, onClick = { onOpen(item) })
                                        if (index < rows.lastIndex) {
                                            HorizontalDivider(
                                                color = MaterialTheme.colorScheme.outlineVariant,
                                                modifier = Modifier.padding(start = 56.dp),
                                            )
                                        }
                                    }
                                }
                            }
                            if (subs.isNotEmpty()) {
                                item(key = "header-subagents") {
                                    ProjectHeader(
                                        folder = "子代理会话",
                                        count = subs.size,
                                        running = subs.count { it.running },
                                        collapsed = collapsed.contains(SUBAGENT_SECTION),
                                        onToggle = {
                                            collapsed = if (collapsed.contains(SUBAGENT_SECTION)) collapsed - SUBAGENT_SECTION
                                            else collapsed + SUBAGENT_SECTION
                                        },
                                    )
                                }
                                if (!collapsed.contains(SUBAGENT_SECTION)) {
                                    itemsIndexed(subs, key = { _, it -> it.sessionId }) { index, item ->
                                        SessionRow(item, onClick = { onOpen(item) })
                                        if (index < subs.lastIndex) {
                                            HorizontalDivider(
                                                color = MaterialTheme.colorScheme.outlineVariant,
                                                modifier = Modifier.padding(start = 56.dp),
                                            )
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
            if (createError != null) {
                Text(
                    createError!!,
                    color = MaterialTheme.colorScheme.error,
                    style = MaterialTheme.typography.labelSmall,
                    modifier = Modifier.fillMaxWidth().padding(horizontal = Spacing.s4),
                )
            }
        }
        ExtendedFloatingActionButton(
            onClick = {
                if (creating) return@ExtendedFloatingActionButton
                creating = true
                createError = null
                scope.launch {
                    try {
                        val id = api.createSession()
                        onOpen(SessionItem(id, "", false, "", "", "", ""))
                    } catch (e: Exception) {
                        createError = e.message ?: "创建失败"
                    } finally {
                        creating = false
                    }
                }
            },
            icon = {
                if (creating) CircularProgressIndicator(modifier = Modifier.size(20.dp))
                else Icon(Icons.Filled.Add, contentDescription = null)
            },
            text = { Text("新建会话") },
            modifier = Modifier.align(Alignment.BottomEnd).padding(Spacing.s4),
        )
    }
}

/** Brand header: mark plus product caption, actions stay icon-only. */
@Composable
private fun ListHeader(runningCount: Int, onRefresh: () -> Unit, onSettings: () -> Unit) {
    Row(
        Modifier.fillMaxWidth().padding(horizontal = Spacing.s4, vertical = Spacing.s3),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        androidx.compose.foundation.Image(
            painterResource(R.drawable.ic_brand_mark),
            contentDescription = null,
            modifier = Modifier.size(28.dp),
        )
        Spacer(Modifier.width(Spacing.s2))
        Column(Modifier.weight(1f)) {
            Text(
                "dsh-remote",
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text("会话", style = MaterialTheme.typography.headlineSmall)
                if (runningCount > 0) {
                    Spacer(Modifier.width(Spacing.s2))
                    ActivePill(runningCount)
                }
            }
        }
        IconButton(onClick = onRefresh) {
            Icon(Icons.Filled.Refresh, contentDescription = "刷新")
        }
        IconButton(onClick = onSettings) {
            Icon(Icons.Filled.Settings, contentDescription = "设置")
        }
    }
}

/** The single primary-colored element on this screen: N running. */
@Composable
private fun ActivePill(count: Int) {
    Surface(
        color = MaterialTheme.colorScheme.primaryContainer,
        contentColor = MaterialTheme.colorScheme.onPrimaryContainer,
        shape = CircleShape,
    ) {
        Text(
            "$count 活跃",
            style = MaterialTheme.typography.labelSmall,
            modifier = Modifier.padding(horizontal = Spacing.s2, vertical = Spacing.s1),
        )
    }
}

/** Borderless search dock: container fill carries the boundary, not a stroke. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun SearchDock(query: String, onQuery: (String) -> Unit) {
    TextField(
        value = query,
        onValueChange = onQuery,
        placeholder = { Text("搜索会话标题或目录") },
        leadingIcon = { Icon(Icons.Filled.Search, contentDescription = null) },
        singleLine = true,
        shape = androidx.compose.foundation.shape.RoundedCornerShape(Radius.input),
        colors = TextFieldDefaults.colors(
            focusedContainerColor = MaterialTheme.colorScheme.surfaceContainerLow,
            unfocusedContainerColor = MaterialTheme.colorScheme.surfaceContainerLow,
            focusedIndicatorColor = androidx.compose.ui.graphics.Color.Transparent,
            unfocusedIndicatorColor = androidx.compose.ui.graphics.Color.Transparent,
        ),
        modifier = Modifier.fillMaxWidth().padding(horizontal = Spacing.s4, vertical = Spacing.s2),
    )
}

/** Project group header: folder plus counts, tap toggles collapse. */
@Composable
private fun ProjectHeader(
    folder: String,
    count: Int,
    running: Int,
    collapsed: Boolean,
    onToggle: () -> Unit,
) {
    Row(
        Modifier.fillMaxWidth()
            .clickable(onClick = onToggle)
            .padding(horizontal = Spacing.s4, vertical = Spacing.s2),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(
            folder,
            style = MaterialTheme.typography.labelMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.weight(1f),
        )
        Text(
            if (running > 0) "$count · $running 运行中" else "$count",
            style = MaterialTheme.typography.labelSmall,
            color = if (running > 0) MaterialTheme.colorScheme.primary
            else MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Spacer(Modifier.width(Spacing.s1))
        Text(
            if (collapsed) "展开" else "折叠",
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.primary,
        )
    }
}

/**
 * Flat session row: typography hierarchy only — 16sp semibold title,
 * 12sp meta, 11sp time. A running session earns a soft primary wash;
 * everything else stays on the paper background. No cards, no borders.
 */
@Composable
private fun SessionRow(item: SessionItem, onClick: () -> Unit) {
    Row(
        modifier = Modifier.fillMaxWidth()
            .background(
                if (item.running) MaterialTheme.colorScheme.primaryContainer.copy(alpha = 0.45f)
                else Color.Transparent,
            )
            .clickable(onClick = onClick)
            .padding(horizontal = Spacing.s4, vertical = Spacing.s4),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        StatusDot(running = item.running)
        Spacer(Modifier.width(Spacing.s3))
        Column(Modifier.weight(1f)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    item.title.ifEmpty { "未命名会话" },
                    style = MaterialTheme.typography.titleSmall,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.weight(1f, fill = false),
                )
                if (item.running) {
                    Spacer(Modifier.width(Spacing.s2))
                    RunningPill()
                }
            }
            Text(
                sessionMeta(item),
                style = MaterialTheme.typography.labelMedium.copy(fontWeight = FontWeight.Normal),
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }
        Spacer(Modifier.width(Spacing.s2))
        Text(
            relativeTime(item.updatedAt),
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Icon(
            Icons.AutoMirrored.Filled.KeyboardArrowRight, contentDescription = null,
            tint = MaterialTheme.colorScheme.outline,
        )
    }
}

private fun sessionMeta(item: SessionItem): String = buildString {
    if (item.origin == "subagent") append("子代理 · ")
    val folder = item.cwd.substringAfterLast('\\').substringAfterLast('/').ifEmpty { "未分组" }
    append(folder)
    if (item.preset.isNotEmpty()) append(" · ${item.preset}")
    if (item.running) append(" · 运行中")
    else if (item.title.isEmpty()) append(" · 草稿")
}

/** Running dot with a breathing pulse; idle is a static neutral dot. */
@Composable
private fun StatusDot(running: Boolean) {
    if (!running) {
        Box(
            Modifier.size(8.dp)
                .background(MaterialTheme.colorScheme.outline.copy(alpha = 0.5f), CircleShape),
        )
        return
    }
    val transition = rememberInfiniteTransition(label = "running-dot")
    val alpha by transition.animateFloat(
        initialValue = 1f,
        targetValue = 0.35f,
        animationSpec = infiniteRepeatable(
            animation = tween(durationMillis = 900),
            repeatMode = RepeatMode.Reverse,
        ),
        label = "dot-alpha",
    )
    Box(
        Modifier.size(10.dp)
            .background(MaterialTheme.colorScheme.primary.copy(alpha = alpha), CircleShape),
    )
}

/** Running is an important state, so it earns the primary pill. */
@Composable
private fun RunningPill() {
    Surface(
        color = MaterialTheme.colorScheme.primaryContainer,
        contentColor = MaterialTheme.colorScheme.onPrimaryContainer,
        shape = CircleShape,
    ) {
        Text(
            "运行中",
            style = MaterialTheme.typography.labelSmall,
            modifier = Modifier.padding(horizontal = Spacing.s2, vertical = 2.dp),
        )
    }
}

/** Group rows by workspace folder; server order (activity) kept inside groups. */
private fun groupByFolder(items: List<SessionItem>): List<Pair<String, List<SessionItem>>> {
    val order = mutableListOf<String>()
    val buckets = mutableMapOf<String, MutableList<SessionItem>>()
    for (item in items) {
        val folder = item.cwd
            .substringAfterLast('\\').substringAfterLast('/')
            .ifEmpty { "未分组" }
        if (!buckets.containsKey(folder)) {
            buckets[folder] = mutableListOf()
            order.add(folder)
        }
        buckets[folder]!!.add(item)
    }
    return order.map { it to buckets[it]!! }
}

private fun relativeTime(time: Long): String {
    if (time <= 0) return ""
    return when {
        DateUtils.isToday(time) -> SimpleDateFormat("HH:mm", Locale.CHINA).format(Date(time))
        DateUtils.isToday(time + DateUtils.DAY_IN_MILLIS) -> "昨天"
        else -> SimpleDateFormat("MM-dd", Locale.CHINA).format(Date(time))
    }
}

@Composable
private fun EmptySessions() {
    Column(
        Modifier.fillMaxSize().padding(Spacing.s5),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Icon(Icons.Filled.Inbox, contentDescription = null, modifier = Modifier.size(32.dp))
        Spacer(Modifier.height(Spacing.s3))
        Text("还没有会话", style = MaterialTheme.typography.titleSmall)
        Spacer(Modifier.height(Spacing.s1))
        Text(
            "点右下角新建一个，或在桌面端开始",
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}

@Composable
private fun SearchEmpty() {
    Column(
        Modifier.fillMaxSize().padding(Spacing.s5),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Icon(
            Icons.Filled.SearchOff, contentDescription = null,
            tint = MaterialTheme.colorScheme.outline,
            modifier = Modifier.size(32.dp),
        )
        Spacer(Modifier.height(Spacing.s3))
        Text("未找到匹配会话", style = MaterialTheme.typography.titleSmall)
        Spacer(Modifier.height(Spacing.s1))
        Text(
            "换个关键词试试",
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}
