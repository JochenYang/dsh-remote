package com.dshremote.app.ui.screens

import androidx.compose.foundation.Image
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
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.ColorFilter
import androidx.compose.ui.input.key.Key
import androidx.compose.ui.input.key.KeyEventType
import androidx.compose.ui.input.key.key
import androidx.compose.ui.input.key.onKeyEvent
import androidx.compose.ui.input.key.type
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.dshremote.app.R
import com.dshremote.app.data.PairResult
import com.dshremote.app.data.RelayClient
import com.dshremote.app.data.RelayError
import com.dshremote.app.ui.components.AppButton
import com.dshremote.app.ui.components.ButtonSize
import com.dshremote.app.ui.theme.MonoFamily
import com.dshremote.app.ui.theme.Radius
import com.dshremote.app.ui.theme.Spacing

/**
 * Step 1: relay URL + 6-box pairing code → paired device.
 * The challenge-response runs here in memory; only the long-lived token is
 * persisted (encrypted) by the caller.
 */
@Composable
fun PairingScreen(onPaired: (relayUrl: String, deviceId: String, token: String) -> Unit) {
    var relayUrl by remember { mutableStateOf("https://") }
    var code by remember { mutableStateOf("") }
    var loading by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }

    Column(
        modifier = Modifier.fillMaxSize().padding(Spacing.s5),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Image(
            painterResource(R.drawable.ic_brand_mark),
            contentDescription = null,
            modifier = Modifier.size(64.dp),
            // The asset ships white strokes (launcher asset); recolor it with
            // the theme primary so it stays visible on both themes.
            colorFilter = ColorFilter.tint(MaterialTheme.colorScheme.primary),
        )
        Spacer(Modifier.height(Spacing.s4))
        Text("连接你的 DSH", style = MaterialTheme.typography.displaySmall)
        Spacer(Modifier.height(Spacing.s2))
        Text(
            "在桌面端「设置 → 手机连接」查看 6 位配对码",
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Spacer(Modifier.height(Spacing.s5))
        OutlinedTextField(
            value = relayUrl, onValueChange = { relayUrl = it; error = null },
            label = { Text("中继地址") }, singleLine = true,
            shape = RoundedCornerShape(Radius.input),
            modifier = Modifier.fillMaxWidth(),
        )
        Spacer(Modifier.height(Spacing.s4))
        Text(
            "6 位配对码",
            style = MaterialTheme.typography.labelMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.fillMaxWidth(),
        )
        Spacer(Modifier.height(Spacing.s2))
        CodeBoxes(
            code = code,
            onChange = { code = it; error = null },
        )
        if (error != null) {
            Spacer(Modifier.height(Spacing.s2))
            Text(error!!, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.labelSmall)
        }
        Spacer(Modifier.height(Spacing.s4))
        AppButton(
            label = "配对",
            onClick = {
                if (code.length != 6) {
                    error = "配对码应为 6 位数字"
                    return@AppButton
                }
                loading = true
                error = null
            },
            modifier = Modifier.fillMaxWidth(),
            size = ButtonSize.L,
            enabled = code.length == 6,
            loading = loading,
        )
        Spacer(Modifier.height(Spacing.s4))
        Text(
            "配对码 10 分钟内有效，过期请在桌面端刷新",
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Spacer(Modifier.height(Spacing.s1))
        Text(
            "只连接你自己的 relay；令牌保存在本机加密存储",
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }

    if (loading) {
        PairingRunner(
            relayUrl = relayUrl.trimEnd('/'),
            code = code,
            onDone = { loading = false; onPaired(relayUrl.trimEnd('/'), it.deviceId, it.token) },
            onError = { loading = false; error = (it as? RelayError)?.message ?: "连接失败" },
        )
    }
}

/**
 * Six-box pairing code field: type advances, backspace retreats, paste fills.
 * One digit per box, mono, input-radius boxes — the pairing-screen signature.
 */
@Composable
private fun CodeBoxes(code: String, onChange: (String) -> Unit) {
    val focusers = remember { List(6) { FocusRequester() } }

    LaunchedEffect(Unit) { focusers[0].requestFocus() }

    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(Spacing.s2),
    ) {
        repeat(6) { index ->
            OutlinedTextField(
                value = code.getOrNull(index)?.toString() ?: "",
                onValueChange = { value ->
                    val digits = value.filter { it.isDigit() }
                    val next = if (digits.isEmpty()) {
                        if (index < code.length) code.removeRange(index, index + 1) else code
                    } else {
                        (code.take(index) + digits).take(6)
                    }
                    onChange(next)
                    if (digits.isNotEmpty() && next.length < 6) {
                        focusers.getOrNull(next.length)?.requestFocus()
                    }
                },
                singleLine = true,
                textStyle = MaterialTheme.typography.headlineSmall.copy(
                    fontFamily = MonoFamily,
                    textAlign = TextAlign.Center,
                ),
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                shape = RoundedCornerShape(Radius.input),
                modifier = Modifier
                    .weight(1f)
                    .focusRequester(focusers[index])
                    .onKeyEvent { event ->
                        if (event.key == Key.Backspace && event.type == KeyEventType.KeyUp &&
                            code.getOrNull(index) == null && index > 0
                        ) {
                            onChange(code.dropLast(1))
                            focusers[index - 1].requestFocus()
                            true
                        } else {
                            false
                        }
                    },
            )
        }
    }
}

/**
 * Runs pair → HMAC challenge-response (phone hello over WS) → cookie claim.
 * The WS hello is the cryptographic proof of code possession; the HTTP claim
 * then mints the cookie the proxy surface uses. Proves, then enters.
 */
@Composable
private fun PairingRunner(
    relayUrl: String,
    code: String,
    onDone: (PairResult) -> Unit,
    onError: (Throwable) -> Unit,
) {
    LaunchedEffect(relayUrl, code) {
        try {
            val client = RelayClient(relayUrl)
            val pair = client.pair(code)
            val response = client.challengeResponse(code, pair.challenge)
            client.phoneHello(pair.deviceId, pair.challenge, response, pair.token)
            client.claim(pair.deviceId, pair.token)
            onDone(pair)
        } catch (t: Throwable) {
            onError(t)
        }
    }
}
