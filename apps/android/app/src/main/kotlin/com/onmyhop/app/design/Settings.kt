package com.onmyhop.app.design

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.ListItemColors
import androidx.compose.material3.ListItemDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.SegmentedListItem
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp

/** One row of a settings group. */
class SettingsRow(
    val onClick: (() -> Unit)?,
    val leading: (@Composable () -> Unit)? = null,
    val trailing: (@Composable () -> Unit)? = null,
    val supporting: (@Composable () -> Unit)? = null,
    val colors: (@Composable () -> ListItemColors)? = null,
    val headline: @Composable () -> Unit,
)

/**
 * Rows grouped the way Android's own settings group them: one rounded
 * block, its rows apart by a hairline gap, with an optional title above.
 */
@Composable
fun SettingsGroup(rows: List<SettingsRow>, modifier: Modifier = Modifier, title: String? = null) {
    Column(modifier.fillMaxWidth().padding(horizontal = 16.dp)) {
        if (title != null) {
            Text(
                title,
                style = MaterialTheme.typography.labelLarge,
                color = MaterialTheme.colorScheme.primary,
                modifier = Modifier.padding(start = 16.dp, bottom = 8.dp, top = 8.dp),
            )
        }
        Column(verticalArrangement = Arrangement.spacedBy(ListItemDefaults.SegmentedGap)) {
            rows.forEachIndexed { index, row ->
                val shapes = ListItemDefaults.segmentedShapes(index = index, count = rows.size)
                val colors = row.colors?.invoke() ?: ListItemDefaults.segmentedColors()
                val onClick = row.onClick
                if (onClick != null) {
                    SegmentedListItem(
                        onClick = onClick,
                        shapes = shapes,
                        leadingContent = row.leading,
                        trailingContent = row.trailing,
                        supportingContent = row.supporting,
                        colors = colors,
                        content = row.headline,
                    )
                } else {
                    SegmentedListItem(
                        shapes = shapes,
                        leadingContent = row.leading,
                        trailingContent = row.trailing,
                        supportingContent = row.supporting,
                        colors = colors,
                        content = row.headline,
                    )
                }
            }
        }
    }
}
