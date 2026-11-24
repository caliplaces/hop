package com.onmyhop.app.feature.myhop

import android.graphics.RuntimeShader
import android.os.Build
import androidx.annotation.RequiresApi
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ShaderBrush
import androidx.compose.ui.graphics.lerp
import androidx.compose.ui.graphics.toArgb

/**
 * The Hop pass's holographic foil, the iPhone app's Metal shader in AGSL:
 * rainbow bands that slide across the card as it tilts, a fine glitter
 * whose grains catch the light at different angles, and a soft sheen that
 * follows the light. It's drawn behind the card's content only, never over
 * the QR code, so the code always scans. Positions are in pixels; `tilt`
 * is -1…1 on each axis.
 */
private const val HOLO_FOIL = """
uniform float2 size;
uniform float2 tilt;
uniform float strength;
layout(color) uniform half4 top;
layout(color) uniform half4 middle;
layout(color) uniform half4 bottom;

half3 rainbow(float hue) {
    float3 p = abs(fract(hue + float3(0.0, 2.0 / 3.0, 1.0 / 3.0)) * 6.0 - 3.0);
    return half3(saturate(p - 1.0));
}

float grain(float2 cell) {
    return fract(sin(dot(cell, float2(127.1, 311.7))) * 43758.5453);
}

half4 main(float2 position) {
    float2 uv = position / size;
    // The card's own gradient, top left to bottom right.
    float along = saturate((uv.x + uv.y) * 0.5);
    half3 base = along < 0.5 ? mix(top.rgb, middle.rgb, half(along * 2.0)) : mix(middle.rgb, bottom.rgb, half((along - 0.5) * 2.0));
    float turn = saturate(length(tilt));

    // Diagonal bands; turning the card moves them along. They tint the
    // colour rather than replace it, faint at rest and blooming as it turns.
    float band = dot(uv, float2(0.62, 0.48)) * 1.35 + tilt.x * 0.6 + tilt.y * 0.4;
    float amount = strength * (0.12 + 0.88 * turn);
    half3 foil = base + (rainbow(band) - 0.5) * half(0.42 * amount);

    // Glitter: a sparse scatter of round grains, each flashing at its own angle.
    float2 cells = position / 9.0;
    float g = grain(floor(cells));
    float lit = smoothstep(0.982, 1.0, fract(g * 9.0 + tilt.x * 1.9 - tilt.y * 1.4));
    float disc = 1.0 - smoothstep(0.12, 0.42, length(fract(cells) - 0.5));
    foil += half3(lit * disc * (0.2 + 0.7 * turn) * strength);

    // Sheen: a soft band of light across the card that follows the tilt.
    float across = uv.x * 0.8 + uv.y * 0.6 - (0.7 + tilt.x * 0.5 - tilt.y * 0.4);
    float sheen = exp(-across * across * 18.0);
    foil += half3(sheen * (0.06 + 0.14 * turn) * strength);

    return half4(saturate(foil), 1.0);
}
"""

/**
 * Paints the foil behind the content, in [color]. Before Android 13, which
 * has no runtime shaders, the card's gradient alone.
 */
@Composable
fun Modifier.holoFoil(color: Color, tilt: () -> Offset): Modifier {
    val top = lerp(color, Color.White, 0.22f)
    val bottom = lerp(color, Color.Black, 0.18f)
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) {
        val gradient = remember(color) { Brush.linearGradient(listOf(top, color, bottom)) }
        return drawBehind { drawRect(gradient) }
    }
    val shader = remember { foilShader() }
    val brush = remember(shader) { ShaderBrush(shader) }
    return drawBehind {
        shader.setFloatUniform("size", size.width, size.height)
        val turn = tilt()
        shader.setFloatUniform("tilt", turn.x, turn.y)
        shader.setFloatUniform("strength", 1f)
        shader.setColorUniform("top", top.toArgb())
        shader.setColorUniform("middle", color.toArgb())
        shader.setColorUniform("bottom", bottom.toArgb())
        drawRect(brush)
    }
}

@RequiresApi(Build.VERSION_CODES.TIRAMISU)
private fun foilShader() = RuntimeShader(HOLO_FOIL)
