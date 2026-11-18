package com.onmyhop.app.design

import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialShapes
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.toPath
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.scale
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Matrix
import androidx.compose.ui.graphics.Outline
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.LayoutDirection
import androidx.compose.ui.unit.dp
import androidx.graphics.shapes.Morph
import com.onmyhop.app.R

/**
 * The athlete palette as swatches. The chosen one swells from a circle into
 * one of Material's expressive cookie shapes, with a check.
 */
@Composable
fun ColorPicker(selected: PaletteColor, onSelect: (PaletteColor) -> Unit, modifier: Modifier = Modifier) {
    val haptics = LocalHapticFeedback.current
    FlowRow(
        modifier.selectableGroup(),
        horizontalArrangement = Arrangement.spacedBy(12.dp, Alignment.CenterHorizontally),
        verticalArrangement = Arrangement.spacedBy(12.dp),
        maxItemsInEachRow = 6,
    ) {
        Palette.all.forEach { color ->
            Swatch(
                color = color,
                isSelected = color == selected,
                onClick = {
                    haptics.performHapticFeedback(HapticFeedbackType.SegmentTick)
                    onSelect(color)
                },
            )
        }
    }
}

@Composable
private fun Swatch(color: PaletteColor, isSelected: Boolean, onClick: () -> Unit) {
    val morph = remember { Morph(MaterialShapes.Circle, MaterialShapes.Cookie9Sided) }
    val spec = MaterialTheme.motionScheme.fastSpatialSpec<Float>()
    val progress by animateFloatAsState(if (isSelected) 1f else 0f, spec, label = "swatch")
    Box(
        Modifier
            .size(48.dp)
            .scale(0.86f + 0.14f * progress)
            .clip(SwatchShape(morph, progress))
            .background(color.color)
            .selectable(selected = isSelected, role = Role.RadioButton, onClick = onClick)
            .semantics { contentDescription = color.name },
        contentAlignment = Alignment.Center,
    ) {
        if (progress > 0.01f) {
            Icon(
                painterResource(R.drawable.ic_check),
                contentDescription = null,
                tint = color.onColor,
                modifier = Modifier.scale(progress),
            )
        }
    }
}

private class SwatchShape(private val morph: Morph, private val progress: Float) : Shape {
    override fun createOutline(size: Size, layoutDirection: LayoutDirection, density: Density): Outline {
        val path: Path = morph.toPath(progress)
        path.transform(Matrix().apply { scale(size.width, size.height) })
        return Outline.Generic(path)
    }
}
