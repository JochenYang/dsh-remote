package com.dshremote.app.ui.screens

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import com.dshremote.app.ui.components.AppButton
import com.dshremote.app.ui.components.ButtonSize
import com.dshremote.app.ui.components.ButtonVariant
import com.dshremote.app.ui.theme.MonoFamily
import com.dshremote.app.ui.theme.Spacing

/**
 * Settings: connection facts (read-only), local unpairing, and about.
 * Nothing here mutates the desktop or the relay — unpairing only forgets the
 * token stored on this phone (re-pair anytime by scanning again).
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SettingsScreen(
    relayUrl: String,
    deviceId: String,
    onBack: () -> Unit,
    onUnpair: () -> Unit,
) {
    var confirmUnpair by remember { mutableStateOf(false) }

    Column(Modifier.fillMaxSize()) {
        TopAppBar(
            title = { Text("设置") },
            navigationIcon = {
                IconButton(onClick = onBack) {
                    Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "返回")
                }
            },
        )
        SettingsRow(label = "中继地址", value = relayUrl)
        SettingsRow(label = "设备", value = deviceId.take(12) + "…")
        Spacer(Modifier.height(Spacing.s4))
        AppButton(
            label = "移除本机配对",
            onClick = { confirmUnpair = true },
            variant = ButtonVariant.Danger,
            size = ButtonSize.L,
            modifier = Modifier.fillMaxWidth().padding(horizontal = Spacing.s4),
        )
        Spacer(Modifier.height(Spacing.s6))
        Text(
            "dsh-remote · Android 客户端（预览版）",
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            textAlign = TextAlign.Center,
            modifier = Modifier.fillMaxWidth(),
        )
        Spacer(Modifier.height(Spacing.s1))
        Text(
            "适用于 DeepSeek Harness 的第三方客户端",
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            textAlign = TextAlign.Center,
            modifier = Modifier.fillMaxWidth(),
        )
        Spacer(Modifier.height(Spacing.s1))
        Text(
            "配对令牌保存在本机加密存储，仅与你的 relay 通信",
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            textAlign = TextAlign.Center,
            modifier = Modifier.fillMaxWidth().padding(horizontal = Spacing.s5),
        )
    }

    if (confirmUnpair) {
        AlertDialog(
            onDismissRequest = { confirmUnpair = false },
            icon = { Icon(Icons.Filled.Warning, contentDescription = null) },
            title = { Text("移除本机配对？") },
            text = { Text("仅删除手机上保存的令牌，电脑侧配对不受影响，可随时重新扫码。") },
            confirmButton = {
                AppButton("移除", onClick = { confirmUnpair = false; onUnpair() }, variant = ButtonVariant.Danger)
            },
            dismissButton = {
                AppButton("取消", onClick = { confirmUnpair = false }, variant = ButtonVariant.Ghost)
            },
        )
    }
}

@Composable
private fun SettingsRow(label: String, value: String) {
    Column(
        Modifier.fillMaxWidth().padding(horizontal = Spacing.s4, vertical = Spacing.s3),
        horizontalAlignment = Alignment.Start,
    ) {
        Text(
            label,
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Text(
            value,
            style = MaterialTheme.typography.bodyMedium.copy(fontFamily = MonoFamily),
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
    }
}
