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
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.ErrorOutline
import androidx.compose.material.icons.filled.Refresh
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
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.dshremote.app.data.DshApi
import com.dshremote.app.ui.components.AppButton
import com.dshremote.app.ui.components.ButtonVariant
import com.dshremote.app.ui.theme.MonoFamily
import com.dshremote.app.ui.theme.Spacing
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

private sealed interface LinkState {
    data object Loading : LinkState
    data class Ready(
        val latencyMs: Long,
        val total: Int,
        val running: Int,
        val checkedAt: Long,
    ) : LinkState
    data class Failed(val message: String) : LinkState
}

/**
 * Link diagnostics: everything here is measured on demand by the probe below.
 * Pairing counts as valid when the probe round-trips; latency is one timed
 * session/list call, not a synthetic ping.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun LinkScreen(api: DshApi, relayUrl: String) {
    var state by remember { mutableStateOf<LinkState>(LinkState.Loading) }
    var nonce by remember { mutableStateOf(0) }

    LaunchedEffect(nonce) {
        state = try {
            val start = System.currentTimeMillis()
            val items = api.sessionList()
            LinkState.Ready(
                latencyMs = System.currentTimeMillis() - start,
                total = items.size,
                running = items.count { it.running },
                checkedAt = System.currentTimeMillis(),
            )
        } catch (e: Exception) {
            LinkState.Failed(e.message ?: "检测失败")
        }
    }

    Column(Modifier.fillMaxSize()) {
        TopAppBar(
            title = { Text("链路") },
            actions = {
                IconButton(onClick = { nonce++ }) {
                    Icon(Icons.Filled.Refresh, contentDescription = "重新检测")
                }
            },
        )
        when (val s = state) {
            LinkState.Loading -> Column(
                Modifier.fillMaxSize(),
                verticalArrangement = Arrangement.Center,
                horizontalAlignment = Alignment.CenterHorizontally,
            ) { CircularProgressIndicator() }

            is LinkState.Failed -> Column(
                Modifier.fillMaxSize().padding(Spacing.s5),
                verticalArrangement = Arrangement.Center,
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                Icon(Icons.Filled.ErrorOutline, contentDescription = null, modifier = Modifier.size(32.dp))
                Spacer(Modifier.height(Spacing.s3))
                Text("链路不通", style = MaterialTheme.typography.titleSmall)
                Spacer(Modifier.height(Spacing.s1))
                Text(
                    s.message,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                Spacer(Modifier.height(Spacing.s3))
                AppButton("重新检测", onClick = { nonce++ }, variant = ButtonVariant.Secondary)
            }

            is LinkState.Ready -> {
                LinkRow(label = "中继地址", value = relayUrl)
                LinkRow(label = "主机", value = "在线 · ${s.latencyMs}ms", ok = true)
                LinkRow(label = "配对", value = "有效", ok = true)
                LinkRow(label = "会话", value = "${s.total} 个 · ${s.running} 运行中")
                LinkRow(
                    label = "检测时间",
                    value = SimpleDateFormat("HH:mm:ss", Locale.CHINA).format(Date(s.checkedAt)),
                )
                Spacer(Modifier.height(Spacing.s2))
                Text(
                    "延迟为一次会话列表往返耗时；配对以该往返成功为准。",
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.fillMaxWidth().padding(horizontal = Spacing.s4),
                )
            }
        }
    }
}

@Composable
private fun LinkRow(label: String, value: String, ok: Boolean = false) {
    Row(
        Modifier.fillMaxWidth().padding(horizontal = Spacing.s4, vertical = Spacing.s3),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(
            label,
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.width(72.dp),
        )
        if (ok) {
            Icon(
                Icons.Filled.CheckCircle,
                contentDescription = null,
                tint = MaterialTheme.colorScheme.tertiary,
                modifier = Modifier.size(16.dp),
            )
            Spacer(Modifier.width(Spacing.s1))
        }
        Text(
            value,
            style = MaterialTheme.typography.bodySmall.copy(fontFamily = MonoFamily),
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            modifier = Modifier.weight(1f),
        )
    }
}
