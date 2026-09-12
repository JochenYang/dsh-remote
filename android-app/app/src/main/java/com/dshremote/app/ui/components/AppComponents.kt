package com.dshremote.app.ui.components

import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.CloudOff
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.unit.dp
import com.dshremote.app.ui.theme.Spacing

/**
 * Shared buttons. Variants are semantic (primary/secondary/ghost/danger),
 * never color names; size is orthogonal (S/M/L). Loading takes priority over
 * Disabled: a loading button shows the spinner and ignores input.
 */
enum class ButtonVariant { Primary, Secondary, Ghost, Danger }
enum class ButtonSize { S, M, L }

@Composable
fun AppButton(
    label: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    variant: ButtonVariant = ButtonVariant.Primary,
    size: ButtonSize = ButtonSize.M,
    enabled: Boolean = true,
    loading: Boolean = false,
) {
    val height = when (size) {
        ButtonSize.S -> 36.dp
        ButtonSize.M -> 48.dp
        ButtonSize.L -> 56.dp
    }
    val content: @Composable () -> Unit = {
        if (loading) {
            CircularProgressIndicator(
                modifier = Modifier.size(18.dp),
                strokeWidth = 2.dp,
            )
            Spacer(Modifier.width(Spacing.s2))
        }
        Text(label)
    }
    val active = enabled && !loading
    val paddings = PaddingValues(horizontal = Spacing.s4)
    when (variant) {
        ButtonVariant.Primary -> Button(
            onClick = onClick, enabled = active, modifier = modifier.height(height),
            contentPadding = paddings, content = { content() },
        )
        ButtonVariant.Secondary -> OutlinedButton(
            onClick = onClick, enabled = active, modifier = modifier.height(height),
            contentPadding = paddings, content = { content() },
        )
        ButtonVariant.Ghost -> TextButton(
            onClick = onClick, enabled = active, modifier = modifier.height(height),
            contentPadding = paddings, content = { content() },
        )
        ButtonVariant.Danger -> Button(
            onClick = onClick, enabled = active, modifier = modifier.height(height),
            colors = ButtonDefaults.buttonColors(
                containerColor = MaterialTheme.colorScheme.error,
                contentColor = MaterialTheme.colorScheme.onError,
            ),
            contentPadding = paddings, content = { content() },
        )
    }
}

/** Full-width status strip. Icon + text always paired (never color alone). */
enum class BannerKind { Offline, Insecure, Error }

@Composable
fun ConnectionBanner(
    kind: BannerKind,
    message: String,
    modifier: Modifier = Modifier,
    onRetry: (() -> Unit)? = null,
) {
    val icon: ImageVector = when (kind) {
        BannerKind.Offline -> Icons.Filled.CloudOff
        BannerKind.Insecure -> Icons.Filled.Warning
        BannerKind.Error -> Icons.Filled.Warning
    }
    Surface(
        modifier = modifier.fillMaxWidth(),
        color = MaterialTheme.colorScheme.surfaceVariant,
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon(
                icon, contentDescription = null,
                tint = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Spacer(Modifier.width(Spacing.s2))
            Text(
                message,
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.weight(1f),
            )
            if (onRetry != null) {
                AppButton("重试", onClick = onRetry, variant = ButtonVariant.Ghost, size = ButtonSize.S)
            }
        }
    }
}

/** Success is icon + text, so grayscale readers still get the message. */
@Composable
fun SuccessLine(message: String, modifier: Modifier = Modifier) {
    Row(modifier = modifier, verticalAlignment = Alignment.CenterVertically) {
        Icon(Icons.Filled.CheckCircle, contentDescription = null)
        Spacer(Modifier.width(Spacing.s2))
        Text(message, style = MaterialTheme.typography.labelSmall)
    }
}
