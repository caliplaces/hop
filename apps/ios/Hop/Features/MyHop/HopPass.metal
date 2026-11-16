// The Hop pass's holographic foil. Applied with colorEffect to the card's
// background only, never over the QR code, so the code always scans.
// Positions are in points; `tilt` is -1…1 on each axis.

#include <metal_stdlib>
#include <SwiftUI/SwiftUI_Metal.h>
using namespace metal;

/// A smooth rainbow: hue 0…1 to RGB at full saturation.
static half3 rainbow(float hue) {
    float3 p = abs(fract(hue + float3(0.0, 2.0 / 3.0, 1.0 / 3.0)) * 6.0 - 3.0);
    return half3(saturate(p - 1.0));
}

static float grain(float2 cell) {
    return fract(sin(dot(cell, float2(127.1, 311.7))) * 43758.5453);
}

/// Rainbow bands that slide across the card as it tilts, a fine glitter whose
/// grains catch the light at different angles, and a soft sheen that follows
/// the light. `strength` 0 leaves the colour as it is.
[[ stitchable ]] half4 holoFoil(
    float2 position, half4 color, float2 size, float2 tilt, float strength
) {
    if (color.a <= 0.0h || strength <= 0.0) {
        return color;
    }
    half3 base = color.rgb / color.a;
    float2 uv = position / size;
    float turn = saturate(length(tilt));

    // Diagonal bands; turning the card moves them along. They tint the
    // colour rather than replace it, faint at rest and blooming as it turns.
    float band = dot(uv, float2(0.62, 0.48)) * 1.35 + tilt.x * 0.6 + tilt.y * 0.4;
    float amount = strength * (0.12 + 0.88 * turn);
    half3 foil = base + (rainbow(band) - 0.5h) * half(0.42 * amount);

    // Glitter: a sparse scatter of round grains, each flashing at its own angle.
    float2 cells = position / 3.0;
    float g = grain(floor(cells));
    float lit = smoothstep(0.982, 1.0, fract(g * 9.0 + tilt.x * 1.9 - tilt.y * 1.4));
    float round = 1.0 - smoothstep(0.12, 0.42, length(fract(cells) - 0.5));
    foil += half3(lit * round * (0.2 + 0.7 * turn) * strength);

    // Sheen: a soft band of light across the card that follows the tilt.
    float across = uv.x * 0.8 + uv.y * 0.6 - (0.7 + tilt.x * 0.5 - tilt.y * 0.4);
    float sheen = exp(-across * across * 18.0);
    foil += half3(sheen * (0.06 + 0.14 * turn) * strength);

    return half4(saturate(foil) * color.a, color.a);
}
