package com.dshremote.app.ui.components

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.AccountTree
import androidx.compose.material.icons.filled.Dashboard
import androidx.compose.material.icons.filled.SmartToy
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.unit.dp
import com.dshremote.app.ui.theme.Spacing

/** Bottom navigation height, single source for list bottom padding. */
val BottomNavHeight = 64.dp

/** Top-level destinations, each backed by measured content — no dead tabs. */
enum class TopDestination(
    val route: String,
    val label: String,
    val icon: ImageVector,
) {
    Fleet("fleet", "总览", Icons.Filled.Dashboard),
    Agents("sessions", "会话", Icons.Filled.SmartToy),
    Chains("chains", "链路", Icons.Filled.AccountTree),
}

/**
 * Custom tab row instead of the stock navigation bar: surface fill, hairline
 * top border, active tab in primary with a soft pill behind its icon.
 */
@Composable
fun BottomNavBar(currentRoute: String?, onSelect: (TopDestination) -> Unit) {
    Surface(color = MaterialTheme.colorScheme.surface) {
        Column {
            HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
            Row(
                Modifier.fillMaxWidth().height(BottomNavHeight)
                    .padding(horizontal = Spacing.s4),
                horizontalArrangement = Arrangement.SpaceAround,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                for (destination in TopDestination.entries) {
                    val selected = currentRoute == destination.route
                    Column(
                        Modifier.clickable { onSelect(destination) }
                            .padding(horizontal = Spacing.s3, vertical = Spacing.s1),
                        horizontalAlignment = Alignment.CenterHorizontally,
                    ) {
                        Surface(
                            color = if (selected) MaterialTheme.colorScheme.primaryContainer
                            else MaterialTheme.colorScheme.surface,
                            shape = androidx.compose.foundation.shape.CircleShape,
                        ) {
                            Icon(
                                destination.icon,
                                contentDescription = destination.label,
                                tint = if (selected) MaterialTheme.colorScheme.onPrimaryContainer
                                else MaterialTheme.colorScheme.onSurfaceVariant,
                                modifier = Modifier.padding(horizontal = Spacing.s4, vertical = Spacing.s1),
                            )
                        }
                        Spacer(Modifier.height(Spacing.s1))
                        Text(
                            destination.label,
                            style = MaterialTheme.typography.labelSmall,
                            color = if (selected) MaterialTheme.colorScheme.onSurface
                            else MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                }
            }
        }
    }
}
