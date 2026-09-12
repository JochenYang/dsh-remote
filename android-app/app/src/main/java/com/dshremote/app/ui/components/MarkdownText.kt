package com.dshremote.app.ui.components

import android.text.method.LinkMovementMethod
import android.widget.TextView
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.viewinterop.AndroidView
import io.noties.markwon.Markwon
import io.noties.markwon.ext.strikethrough.StrikethroughPlugin
import io.noties.markwon.ext.tables.TablePlugin
import io.noties.markwon.linkify.LinkifyPlugin

/**
 * App-wide Markwon instance: tables, strikethrough, autolinks. One instance is
 * reused by every markdown block (builder cost is not per-message). No image
 * loader and no syntax highlight by design: remote images never load through
 * the tunnel automatically, and highlight ships in a later pass.
 */
@Composable
fun rememberMarkwon(): Markwon {
    val context = LocalContext.current
    return remember {
        Markwon.builder(context)
            .usePlugin(TablePlugin.create(context))
            .usePlugin(StrikethroughPlugin.create())
            .usePlugin(LinkifyPlugin.create())
            .build()
    }
}

/**
 * Render one markdown document into a themed TextView. Text color follows the
 * composition theme (dark/light both covered); links open externally and never
 * execute anything. 16sp matches the chat body grade.
 */
@Composable
fun MarkdownText(markwon: Markwon, markdown: String, modifier: Modifier = Modifier, textSizeSp: Float = 16f) {
    val onSurface = MaterialTheme.colorScheme.onSurface
    AndroidView(
        modifier = modifier,
        factory = { context ->
            TextView(context).apply {
                textSize = textSizeSp
                movementMethod = LinkMovementMethod.getInstance()
                highlightColor = android.graphics.Color.TRANSPARENT
            }
        },
        update = { view ->
            view.setTextColor(onSurface.toArgb())
            markwon.setMarkdown(view, markdown)
        },
    )
}
