package com.dshremote.app.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.ContentCopy
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.dshremote.app.ui.theme.MonoFamily
import com.dshremote.app.ui.theme.Radius
import com.dshremote.app.ui.theme.Spacing
import io.noties.markwon.Markwon
import kotlinx.coroutines.delay
import androidx.compose.runtime.LaunchedEffect

/**
 * First-class markdown blocks for assistant replies. A raw renderer dump is
 * not a reading interface: `##` sections become headed cards and fenced code
 * becomes a copyable code card. Everything else stays one markdown chunk.
 */
sealed interface MdBlock {
    data class Prose(val markdown: String) : MdBlock
    data class Section(val title: String, val markdown: String) : MdBlock
    data class Code(val language: String, val code: String) : MdBlock
}

/** Line-based splitter; unclosed fences degrade to code rather than vanishing. */
fun splitMarkdown(source: String): List<MdBlock> {
    val out = mutableListOf<MdBlock>()
    val prose = StringBuilder()
    var sectionTitle: String? = null
    val sectionBody = StringBuilder()
    var inFence = false
    var fenceLang = ""
    val fenceBody = StringBuilder()

    fun flushProse() {
        if (prose.isNotBlank()) {
            if (sectionTitle != null) sectionBody.append(prose)
            else out += MdBlock.Prose(prose.toString().trim())
            prose.clear()
        }
    }
    fun flushSection() {
        if (sectionTitle != null) {
            out += MdBlock.Section(sectionTitle!!, sectionBody.toString().trim())
            sectionTitle = null
            sectionBody.clear()
        }
    }

    for (line in source.lines()) {
        val stripped = line.trimStart()
        if (stripped.startsWith("```")) {
            if (!inFence) {
                inFence = true
                fenceLang = stripped.removePrefix("```").trim()
            } else {
                inFence = false
                flushProse()
                flushSection()
                out += MdBlock.Code(fenceLang, fenceBody.toString().trimEnd('\n'))
                fenceBody.clear()
                fenceLang = ""
            }
            continue
        }
        if (inFence) {
            fenceBody.appendLine(line)
            continue
        }
        val heading = Regex("^#{2,3}\\s+(.+)").find(line.trim())
        if (heading != null) {
            flushProse()
            flushSection()
            sectionTitle = heading.groupValues[1].trim()
            continue
        }
        prose.appendLine(line)
    }
    if (inFence) {
        flushProse()
        flushSection()
        out += MdBlock.Code(fenceLang, fenceBody.toString().trimEnd('\n'))
    }
    flushProse()
    flushSection()
    return out
}

/** One headed section card; rail color alternates deterministically by order. */
@Composable
fun SectionCard(
    title: String,
    markwon: Markwon,
    markdown: String,
    primaryRail: Boolean,
    modifier: Modifier = Modifier,
) {
    Card(
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainerLowest),
        shape = androidx.compose.foundation.shape.RoundedCornerShape(Radius.card),
        modifier = modifier.fillMaxWidth(),
    ) {
        Row(Modifier.fillMaxWidth().padding(Spacing.s4)) {
            androidx.compose.foundation.layout.Box(
                Modifier
                    .width(4.dp)
                    .height(22.dp)
                    .background(
                        if (primaryRail) MaterialTheme.colorScheme.primary
                        else MaterialTheme.colorScheme.tertiary,
                        androidx.compose.foundation.shape.RoundedCornerShape(2.dp),
                    ),
            )
            Spacer(Modifier.width(Spacing.s2))
            Text(
                title,
                style = MaterialTheme.typography.titleSmall,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
            )
        }
        if (markdown.isNotEmpty()) {
            MarkdownText(
                markwon, markdown,
                modifier = Modifier.fillMaxWidth().padding(horizontal = Spacing.s4),
            )
            Spacer(Modifier.height(Spacing.s3))
        }
    }
}

/** Fenced code with language label and a real copy action. */
@Composable
fun CodeBlockCard(language: String, code: String, modifier: Modifier = Modifier) {
    val clipboard = LocalClipboardManager.current
    var copied by remember { mutableStateOf(false) }
    if (copied) {
        LaunchedEffect(Unit) {
            delay(1_500)
            copied = false
        }
    }
    Card(
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainerLow),
        shape = androidx.compose.foundation.shape.RoundedCornerShape(Radius.card),
        modifier = modifier.fillMaxWidth(),
    ) {
        Row(
            Modifier.fillMaxWidth().padding(start = Spacing.s4, end = Spacing.s2, top = Spacing.s2),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                language.ifEmpty { "代码" },
                style = MaterialTheme.typography.labelMedium.copy(fontFamily = MonoFamily),
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.weight(1f),
                maxLines = 1,
            )
            IconButton(onClick = {
                clipboard.setText(AnnotatedString(code))
                copied = true
            }) {
                Icon(
                    if (copied) Icons.Filled.Check else Icons.Filled.ContentCopy,
                    contentDescription = if (copied) "已复制" else "复制代码",
                )
            }
        }
        Text(
            code,
            style = MaterialTheme.typography.bodySmall.copy(fontFamily = MonoFamily),
            modifier = Modifier.fillMaxWidth().padding(start = Spacing.s4, end = Spacing.s4, bottom = Spacing.s3),
        )
    }
}
