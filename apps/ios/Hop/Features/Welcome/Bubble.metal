// The welcome bubble: a drop of clear liquid glass.
// Positions are in points, in the coordinate space of the view being drawn.
// `scale` stretches the bubble into an ellipse while it moves.

#include <metal_stdlib>
#include <SwiftUI/SwiftUI_Metal.h>
using namespace metal;

/// Magnifies whatever is behind the bubble, like looking through a water
/// droplet.
[[ stitchable ]] half4 bubbleLens(
    float2 position, SwiftUI::Layer layer,
    float2 center, float radius, float2 scale, float strength, float2 bounds
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
    // Off-screen samples would be transparent and show as a dark fringe at
    // the bottom edge, so keep them on screen.
    return layer.sample(clamp(center + d * m, float2(0.5), bounds - 0.5));
}

/// The bubble's skin: a soft rim of light, a key highlight, a bounce light
/// and a crisp edge, all colourless. Applied to a filled rectangle covering
/// the screen; returns premultiplied colour.
[[ stitchable ]] half4 bubbleRim(
    float2 position, half4 color,
    float2 center, float radius, float2 scale, float dark, float opacity
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

    // Highlights are placed by the surface normal they peak at: a small, sharp
    // glint up and to the left (inside the cap that shows at rest) and a broad
    // bounce light low on the right.
    float3 key = normalize(float3(-0.52, -0.58, 0.63));
    float3 bounce = normalize(float3(0.5, 0.55, 0.67));
    float highlight = pow(max(dot(n, key), 0.0), 320.0) * 0.9;
    float glow = pow(max(dot(n, bounce), 0.0), 18.0) * 0.18;
    float edge = smoothstep(1.0 - 4.0 * aa, 1.0 - aa, x);

    float alpha;
    float3 rgb;
    if (dark > 0.5) {
        // Light catching the rim, brightest where the glass is most oblique.
        float rim = fresnel * 0.4;
        alpha = rim + highlight + glow + edge * 0.3;
        rgb = float3(alpha);
    } else {
        // White highlights vanish on a light canvas, so the rim and edge are
        // a faint ink, with a little shade under the bubble for depth.
        float rim = fresnel * 0.22;
        float shade = smoothstep(0.1, 1.0, q.y) * (1.0 - h) * 0.12;
        float ink = rim + edge * 0.22 + shade;
        float white = highlight + glow;
        alpha = ink + white;
        rgb = float3(0.04) * ink + float3(white);
    }
    alpha = clamp(alpha, 0.0, 1.0);
    rgb = min(rgb, float3(alpha));
    return half4(half3(rgb), half(alpha)) * half(inside * opacity);
}
