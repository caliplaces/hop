import CoreGraphics
import SwiftUI

/// Where the welcome bubble sits, how it answers a drag, and how it opens into
/// the sign-in screen. Pure geometry in points, so it can be unit-tested.
nonisolated struct BubbleLayout: Equatable, Sendable {
    /// The full screen, safe areas included.
    let size: CGSize
    let insets: EdgeInsets

    init(size: CGSize, insets: EdgeInsets = EdgeInsets()) {
        self.size = size
        self.insets = insets
    }

    /// Past this much progress, letting go opens the bubble.
    static let openThreshold: CGFloat = 0.5

    // MARK: Resting

    /// The bubble's radius at rest, peeking out of the bottom edge.
    var restRadius: CGFloat { min(size.width * 0.44, 210) }

    /// At rest the centre sits just below the screen, so only the top cap shows.
    var restCenter: CGPoint {
        CGPoint(x: size.width / 2, y: size.height + restRadius * 0.24)
    }

    /// How far a finger travels upward for the bubble to grow fully.
    var travel: CGFloat { max(size.height * 0.4, 1) }

    /// Touches count if they start on the bubble or near the bottom edge,
    /// like the Lock Screen's swipe up.
    func acceptsTouch(at point: CGPoint) -> Bool {
        let distance = hypot(point.x - restCenter.x, point.y - restCenter.y)
        return distance <= restRadius + 28 || point.y >= size.height * 0.82
    }

    // MARK: Dragging

    /// 0 at rest, 1 once the finger has travelled the full distance up.
    func progress(for translation: CGSize) -> CGFloat {
        min(max(-translation.height / travel, 0), 1)
    }

    /// The bubble tracks the finger upward. Beyond full growth, downward and
    /// sideways it resists like a rubber band.
    func center(for translation: CGSize) -> CGPoint {
        let up = -translation.height
        let lift: CGFloat
        if up < 0 {
            lift = -Self.rubberBand(-up, limit: 36)
        } else if up <= travel {
            lift = up
        } else {
            lift = travel + Self.rubberBand(up - travel, limit: size.height * 0.12)
        }
        return CGPoint(
            x: restCenter.x + Self.rubberBand(translation.width, limit: size.width * 0.16),
            y: restCenter.y - lift
        )
    }

    /// The bubble swells as it rises.
    func radius(progress: CGFloat) -> CGFloat {
        let eased = 1 - (1 - progress) * (1 - progress)
        return restRadius * (1 + 0.3 * eased)
    }

    /// Opens when dragged past the threshold, or when flicked hard enough
    /// that it would have travelled most of the way.
    func shouldOpen(translation: CGSize, predictedEndTranslation: CGSize) -> Bool {
        progress(for: translation) >= Self.openThreshold
            || (translation.height < -24 && progress(for: predictedEndTranslation) >= 0.9)
    }

    // MARK: Open

    /// Where the bubble settles once it has swallowed the screen.
    var openCenter: CGPoint { CGPoint(x: size.width / 2, y: size.height * 0.42) }

    /// Large enough for the bubble to cover every corner from `openCenter`.
    var openRadius: CGFloat {
        let dx = max(openCenter.x, size.width - openCenter.x)
        let dy = max(openCenter.y, size.height - openCenter.y)
        return hypot(dx, dy) * 1.04
    }

    /// Bobble's place on the sign-in screen.
    var heroCenter: CGPoint { CGPoint(x: size.width / 2, y: insets.top + size.height * 0.24) }
    var heroSize: CGFloat { min(size.width * 0.58, 250) }

    // MARK: Motion

    /// How much a moving bubble stretches along its path, from the drag's
    /// velocity in points per second. Squash comes from the spring on release.
    static func stretch(forVelocity velocity: CGSize) -> CGFloat {
        min(abs(velocity.height) / 2600, 0.16)
    }

    /// Volume-preserving scale for a stretch: taller and thinner, or the reverse.
    static func scale(forStretch stretch: CGFloat) -> CGSize {
        CGSize(width: 1 - stretch * 0.55, height: 1 + stretch)
    }

    /// Apple's rubber-band curve: moves 1:1 at first, then never past `limit`.
    static func rubberBand(_ offset: CGFloat, limit: CGFloat, coefficient: CGFloat = 0.55) -> CGFloat {
        guard limit > 0 else { return 0 }
        let magnitude = (1 - 1 / (abs(offset) * coefficient / limit + 1)) * limit
        return offset < 0 ? -magnitude : magnitude
    }

    // MARK: Frames

    /// Everything the welcome scene draws for one frame.
    struct Frame: Equatable, Sendable {
        var center: CGPoint
        var radius: CGFloat
        var scale: CGSize
        /// Drag progress, 0…1.
        var progress: CGFloat
        /// How much of the sign-in world shows through the bubble, 0…1.
        var portalFill: CGFloat
        var bobbleCenter: CGPoint
        var bobbleSize: CGFloat
        /// Crossfade from Bobble idling to cheering, 0…1.
        var cheer: CGFloat
        /// How strongly the bubble magnifies what's behind it.
        var lensStrength: CGFloat
        var rimOpacity: CGFloat
        var hintOpacity: CGFloat
    }

    /// - Parameters:
    ///   - opened: 0 while the bubble is being dragged, 1 once it fills the screen.
    ///   - time: seconds, for the idle breathing; pass 0 to hold still.
    ///   - reduceMotion: open with a crossfade instead of the expansion.
    func frame(
        drag: CGSize, stretch: CGFloat, opened: CGFloat, time: Double, reduceMotion: Bool
    ) -> Frame {
        let progress = progress(for: drag)
        let resting = (1 - progress) * (1 - min(max(opened, 0), 1))

        // At rest the bubble breathes, and every few seconds it gives a small
        // hop to show that it moves.
        let breath = 1 + 0.012 * sin(time * 1.8) * resting
        let nudge = 9 * pow(max(0, sin(time * 1.25)), 8) * resting

        var center = center(for: drag)
        center.y -= nudge
        var radius = radius(progress: progress) * breath
        var scale = Self.scale(forStretch: stretch)

        // Bobble rises inside the bubble as it lifts, eyes first.
        var bobbleSize = radius * 1.05
        var bobbleCenter = CGPoint(x: center.x, y: center.y + radius * (0.62 - 0.55 * progress))

        let fill = 0.88 * smoothstep(0, 0.85, progress)

        if reduceMotion && opened > 0 {
            // A crossfade: the bubble stays put and the sign-in world fades in.
            return Frame(
                center: openCenter, radius: openRadius, scale: CGSize(width: 1, height: 1),
                progress: progress, portalFill: opened,
                bobbleCenter: heroCenter, bobbleSize: heroSize, cheer: 1,
                lensStrength: 0, rimOpacity: 0, hintOpacity: 0
            )
        }

        let open = opened
        center = Self.mix(center, openCenter, open)
        radius = Self.mix(radius, openRadius, open)
        scale = CGSize(
            width: Self.mix(scale.width, 1, open),
            height: Self.mix(scale.height, 1, open)
        )
        bobbleCenter = Self.mix(bobbleCenter, heroCenter, open)
        bobbleSize = Self.mix(bobbleSize, heroSize, open)

        return Frame(
            center: center,
            radius: radius,
            scale: scale,
            progress: progress,
            portalFill: Self.mix(fill, 1, min(max(open * 1.6, 0), 1)),
            bobbleCenter: bobbleCenter,
            bobbleSize: bobbleSize,
            cheer: smoothstep(0.35, 0.6, open),
            lensStrength: 0.32 * pow(max(1 - open, 0), 2),
            rimOpacity: max(1 - open * 1.25, 0),
            hintOpacity: max(1 - progress * 3, 0) * max(1 - open * 4, 0)
        )
    }

    private static func mix(_ a: CGFloat, _ b: CGFloat, _ t: CGFloat) -> CGFloat {
        a + (b - a) * t
    }

    private static func mix(_ a: CGPoint, _ b: CGPoint, _ t: CGFloat) -> CGPoint {
        CGPoint(x: mix(a.x, b.x, t), y: mix(a.y, b.y, t))
    }
}

nonisolated private func smoothstep(_ edge0: CGFloat, _ edge1: CGFloat, _ x: CGFloat) -> CGFloat {
    let t = min(max((x - edge0) / (edge1 - edge0), 0), 1)
    return t * t * (3 - 2 * t)
}
