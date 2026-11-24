package com.onmyhop.app.design

import androidx.annotation.DrawableRes
import androidx.compose.runtime.Immutable
import androidx.compose.ui.graphics.Color
import com.onmyhop.app.R
import kotlin.math.max
import kotlin.math.min
import kotlin.math.pow

/**
 * One of the colours an athlete picks for their Hop. Used as a fill or a
 * tint, never as text on the canvas.
 */
@Immutable
data class PaletteColor(val id: String, val name: String, val hex: Int, @param:DrawableRes val bobble: Int) {
    val color: Color get() = Color(0xFF000000.toInt() or hex)

    /** Ink or white, whichever reads better on this colour (as `textOn` on the web). */
    val onColorHex: Int
        get() = if (Palette.contrast(hex, INK) >= Palette.contrast(hex, WHITE)) INK else WHITE

    val onColor: Color get() = Color(0xFF000000.toInt() or onColorHex)

    companion object {
        const val INK = 0x0B0B0C
        const val WHITE = 0xFFFFFF
    }
}

/** The athlete palette, mirrored from packages/shared/src/colors.ts. `PaletteTest` fails if they drift apart. */
object Palette {
    val coral = PaletteColor("coral", "Coral", 0xFF6B5B, R.drawable.bobble_coral)
    val tangerine = PaletteColor("tangerine", "Tangerine", 0xFF9F1C, R.drawable.bobble_tangerine)
    val sunflower = PaletteColor("sunflower", "Sunflower", 0xFFC93C, R.drawable.bobble_sunflower)
    val mint = PaletteColor("mint", "Mint", 0x3DDC97, R.drawable.bobble_mint)
    val teal = PaletteColor("teal", "Teal", 0x14B8A6, R.drawable.bobble_teal)
    val sky = PaletteColor("sky", "Sky", 0x38BDF8, R.drawable.bobble_sky)
    val ocean = PaletteColor("ocean", "Ocean", 0x2563EB, R.drawable.bobble_ocean)
    val indigo = PaletteColor("indigo", "Indigo", 0x5B5BF0, R.drawable.bobble_indigo)
    val grape = PaletteColor("grape", "Grape", 0x7C4DFF, R.drawable.bobble_grape)
    val bubblegum = PaletteColor("bubblegum", "Bubblegum", 0xF472B6, R.drawable.bobble_bubblegum)
    val cherry = PaletteColor("cherry", "Cherry", 0xE11D48, R.drawable.bobble_cherry)
    val graphite = PaletteColor("graphite", "Graphite", 0x3F3F46, R.drawable.bobble_graphite)

    val all = listOf(coral, tangerine, sunflower, mint, teal, sky, ocean, indigo, grape, bubblegum, cherry, graphite)

    /** Hop's own colour, for screens that don't belong to an athlete yet. */
    val brand = grape

    /** The colour with this id, or Hop's own when the id is unknown. */
    fun color(id: String?): PaletteColor = all.firstOrNull { it.id == id } ?: brand

    /** WCAG contrast ratio between two 0xRRGGBB colours, as on the web. */
    fun contrast(a: Int, b: Int): Double {
        val (la, lb) = luminance(a) to luminance(b)
        return (max(la, lb) + 0.05) / (min(la, lb) + 0.05)
    }

    private fun luminance(hex: Int): Double {
        val (r, g, b) = listOf(16, 8, 0).map { shift ->
            val c = ((hex shr shift) and 0xFF) / 255.0
            if (c <= 0.03928) c / 12.92 else ((c + 0.055) / 1.055).pow(2.4)
        }
        return 0.2126 * r + 0.7152 * g + 0.0722 * b
    }
}
