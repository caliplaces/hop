// The welcome bubble: a drop of liquid glass with a soap film on its skin.
// Positions are in points, in the coordinate space of the view being drawn.
// `scale` stretches the bubble into an ellipse while it moves.

#include <metal_stdlib>
#include <SwiftUI/SwiftUI_Metal.h>
using namespace metal;

/// Magnifies whatever is behind the bubble, like looking through a water
/// droplet, with a little colour fringing towards the rim.
[[ stitchable ]] half4 bubbleLens(
    float2 position, SwiftUI::Layer layer,
    float2 center, float radius, float2 scale, float strength, float aberration, float2 bounds
) {
    float2 d = position - center;
    float2 q = d / (radius * scale);
    float x2 = dot(q, q);
    if (x2 >= 1.0 || strength <= 0.0) {
        return layer.sample(position);
    }
    // Height of a sphere at this point: 1 in the middle, 0 at the rim. Using
    // it as the magnification keeps the edge continuous with the outside.
    float h = sqrt(1.0 - x2);
    float m = 1.0 - strength * h;
    float a = aberration * (1.0 - h);
    // Off-screen samples would be transparent and show as a dark fringe at
    // the bottom edge, so keep them on screen.
    float2 lo = float2(0.5);
    float2 hi = bounds - 0.5;
    half4 green = layer.sample(clamp(center + d * m, lo, hi));
    half4 red = layer.sample(clamp(center + d * (m + a), lo, hi));
    half4 blue = layer.sample(clamp(center + d * (m - a), lo, hi));
    return half4(red.r, green.g, blue.b, green.a);
}

/// The bubble's skin: an iridescent film that drifts around the rim, a key
/// highlight, a soft bounce light and a crisp edge. Applied to a filled
/// rectangle covering the screen; returns premultiplied colour.
[[ stitchable ]] half4 bubbleRim(
    float2 position, half4 color,
    float2 center, float radius, float2 scale, float time, float dark, float opacity
) {
    float2 q = (position - center) / (radius * scale);
    float x = length(q);
    float aa = 1.5 / radius; // about a point and a half, in bubble units
    if (x > 1.0 + aa || opacity <= 0.0) {
        return half4(0.0);
    }
    float inside = 1.0 - smoothstep(1.0 - aa, 1.0 + aa, x);
    float h = sqrt(max(0.0, 1.0 - x * x));
    float3 n = normalize(float3(q, h)); // y points down, as in SwiftUI
    float fresnel = pow(1.0 - h, 2.6);

    // Thin-film interference: hue follows the film's thickness, which swirls
    // slowly around the rim.
    float angle = atan2(q.y, q.x);
    float film = 0.35 * sin(angle * 2.0 + time * 0.5)
               + 0.22 * sin(angle * 3.0 - time * 0.33)
               + x * 0.9 + time * 0.04;
    float3 iridescence = 0.55 + 0.45 * cos(6.2831853 * (film + float3(0.0, 0.33, 0.67)));

    // Highlights are placed by the surface normal they peak at: a small, sharp
    // glint up and to the left (inside the cap that shows at rest) and a broad
    // bounce light low on the right.
    float3 key = normalize(float3(-0.52, -0.58, 0.63));
    float3 bounce = normalize(float3(0.5, 0.55, 0.67));
    float highlight = pow(max(dot(n, key), 0.0), 320.0) * 0.9;
    float glow = pow(max(dot(n, bounce), 0.0), 18.0) * 0.18;
    float edge = smoothstep(1.0 - 4.0 * aa, 1.0 - aa, x);

    float3 rgb;
    float alpha;
    if (dark > 0.5) {
        float filmAlpha = fresnel * 0.6;
        rgb = iridescence * filmAlpha + float3(highlight + glow) + float3(edge * 0.3);
        alpha = filmAlpha + highlight + glow + edge * 0.3;
    } else {
        // White highlights vanish on a light canvas, so the film is deeper and
        // the edge and the shade under the bubble are ink.
        float filmAlpha = fresnel * 0.7;
        float shade = smoothstep(0.1, 1.0, q.y) * (1.0 - h) * 0.12;
        float3 ink = float3(0.04);
        rgb = iridescence * 0.85 * filmAlpha + float3(highlight + glow) + ink * (edge * 0.22 + shade);
        alpha = filmAlpha + highlight + glow + edge * 0.22 + shade;
    }
    alpha = clamp(alpha, 0.0, 1.0);
    rgb = min(rgb, float3(alpha));
    return half4(half3(rgb), half(alpha)) * half(inside * opacity);
}
