package com.dshremote.app.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.ErrorOutline
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.dshremote.app.data.DshApi
import com.dshremote.app.data.SessionItem
import com.dshremote.app.ui.components.AppButton
import com.dshremote.app.ui.components.ButtonVariant
import com.dshremote.app.ui.theme.MonoFamily
import com.dshremote.app.ui.theme.Radius
import com.dshremote.app.ui.theme.Spacing
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import kotlinx.coroutines.launch

private sealed interface OverviewState {
    data object Loading : OverviewState
    data class Ready(
        val latencyMs: Long,
        val total: Int,
        val running: Int,
        val subagents: Int,
        val checkedAt: Long,
    ) : OverviewState
    data class Failed(val message: String) : OverviewState
}

/**
 * Overview: host liveness plus session counts, all from one timed list probe.
 * Every number on this screen is measured, none is fabricated.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun OverviewScreen(
    api: DshApi,
    relayUrl: String,
    deviceId: String,
    onOpenSessions: () -> Unit,
    onSessionCreated: (SessionItem) -> Unit,
) {
    var state by remember { mutableStateOf<OverviewState>(OverviewState.Loading) }
    var nonce by remember { mutableStateOf(0) }
    var creating by remember { mutableStateOf(false) }
    var createError by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()

    LaunchedEffect(nonce) {
        state = try {
            val start = System.currentTimeMillis()
            val items = api.sessionList()
            OverviewState.Ready(
                latencyMs = System.currentTimeMillis() - start,
                total = items.size,
                running = items.count { it.running },
                subagents = items.count { it.origin == "subagent" },
                checkedAt = System.currentTimeMillis(),
            )
        } catch (e: Exception) {
            OverviewState.Failed(e.message ?: "检测失败")
        }
    }

    Column(Modifier.fillMaxSize()) {
        TopAppBar(
            title = { Text("总览") },
            actions = {
                IconButton(onClick = { nonce++ }) {
                    Icon(Icons.Filled.Refresh, contentDescription = "重新检测")
                }
            },
        )
        when (val s = state) {
            OverviewState.Loading -> Column(
                Modifier.fillMaxSize(),
                verticalArrangement = Arrangement.Center,
                horizontalAlignment = Alignment.CenterHorizontally,
            ) { CircularProgressIndicator() }

            is OverviewState.Failed -> Column(
                Modifier.fillMaxSize().padding(Spacing.s5),
                verticalArrangement = Arrangement.Center,
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                Icon(Icons.Filled.ErrorOutline, contentDescription = null, modifier = Modifier.size(32.dp))
                Spacer(Modifier.height(Spacing.s3))
                Text("主机不可达", style = MaterialTheme.typography.titleSmall)
                Spacer(Modifier.height(Spacing.s1))
                Text(
                    s.message,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                Spacer(Modifier.height(Spacing.s3))
                AppButton("重试", onClick = { nonce++ }, variant = ButtonVariant.Secondary)
            }

            is OverviewState.Ready -> {
                HostCard(
                    online = true,
                    latencyMs = s.latencyMs,
                    relayUrl = relayUrl,
                    deviceId = deviceId,
                )
                Spacer(Modifier.height(Spacing.s3))
                Row(
                    Modifier.fillMaxWidth().padding(horizontal = Spacing.s4),
                    horizontalArrangement = Arrangement.spacedBy(Spacing.s2),
                ) {
                    StatCard(label = "会话", value = "${s.total}", modifier = Modifier.weight(1f))
                    StatCard(label = "运行中", value = "${s.running}", modifier = Modifier.weight(1f))
                    StatCard(label = "子代理", value = "${s.subagents}", modifier = Modifier.weight(1f))
                }
                Spacer(Modifier.height(Spacing.s1))
                Text(
                    "检测于 ${SimpleDateFormat("HH:mm:ss", Locale.CHINA).format(Date(s.checkedAt))}" +
                        " · 一次列表往返耗时 ${s.latencyMs}ms",
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.fillMaxWidth().padding(horizontal = Spacing.s4),
                )
                Spacer(Modifier.height(Spacing.s4))
                Row(
                    Modifier.fillMaxWidth().padding(horizontal = Spacing.s4),
                    horizontalArrangement = Arrangement.spacedBy(Spacing.s2),
                ) {
                    AppButton(
                        "去会话列表",
                        onClick = onOpenSessions,
                        variant = ButtonVariant.Secondary,
                        modifier = Modifier.weight(1f),
                    )
                    AppButton(
                        "新建会话",
                        onClick = {
                            if (creating) return@AppButton
                            creating = true
                            createError = null
                            scope.launch {
                                try {
                                    val id = api.createSession()
                                    onSessionCreated(SessionItem(id, "", false, "", "", "", ""))
                                } catch (e: Exception) {
                                    createError = e.message ?: "创建失败"
                                } finally {
                                    creating = false
                                }
                            }
                        },
                        variant = ButtonVariant.Primary,
                        modifier = Modifier.weight(1f),
                    )
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
        }
    }
}

@Composable
private fun HostCard(online: Boolean, latencyMs: Long, relayUrl: String, deviceId: String) {
    Card(
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainerLowest),
        shape = androidx.compose.foundation.shape.RoundedCornerShape(Radius.card),
        modifier = Modifier.fillMaxWidth().padding(horizontal = Spacing.s4),
    ) {
        Column(Modifier.fillMaxWidth().padding(Spacing.s4)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(
                    if (online) Icons.Filled.CheckCircle else Icons.Filled.ErrorOutline,
                    contentDescription = null,
                    tint = if (online) MaterialTheme.colorScheme.tertiary
                    else MaterialTheme.colorScheme.error,
                )
                Spacer(Modifier.width(Spacing.s2))
                Text(
                    if (online) "主机在线 · ${latencyMs}ms" else "主机离线",
                    style = MaterialTheme.typography.titleSmall,
                )
            }
            Spacer(Modifier.height(Spacing.s2))
            Text(
                relayUrl,
                style = MaterialTheme.typography.labelSmall.copy(fontFamily = MonoFamily),
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            Text(
                "设备 ${deviceId.take(12)}…",
                style = MaterialTheme.typography.labelSmall.copy(fontFamily = MonoFamily),
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

@Composable
private fun StatCard(label: String, value: String, modifier: Modifier = Modifier) {
    Card(
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainerLowest),
        shape = androidx.compose.foundation.shape.RoundedCornerShape(Radius.card),
        modifier = modifier,
    ) {
        Column(Modifier.fillMaxWidth().padding(Spacing.s3)) {
            Text(
                value,
                style = MaterialTheme.typography.headlineSmall,
                color = MaterialTheme.colorScheme.primary,
            )
            Text(
                label,
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}
