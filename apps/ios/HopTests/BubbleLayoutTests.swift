import CoreGraphics
import Testing
@testable import Hop

@Suite("Welcome bubble")
struct BubbleLayoutTests {
    /// An iPhone 17 Pro's screen in points.
    let layout = BubbleLayout(size: CGSize(width: 402, height: 874))

    @Test func peeksOutOfTheBottomEdge() {
        let top = layout.restCenter.y - layout.restRadius
        #expect(layout.restCenter.y > layout.size.height)
        #expect(top < layout.size.height - 100)
    }

    @Test func progressFollowsTheFingerUpAndIsClamped() {
        #expect(layout.progress(for: .zero) == 0)
        #expect(layout.progress(for: CGSize(width: 0, height: 120)) == 0)
        #expect(layout.progress(for: CGSize(width: 0, height: -layout.travel / 2)) == 0.5)
        #expect(layout.progress(for: CGSize(width: 0, height: -layout.travel * 3)) == 1)
    }

    @Test func tracksTheFingerOneToOneWithinTravel() {
        let center = layout.center(for: CGSize(width: 0, height: -100))
        #expect(center.y == layout.restCenter.y - 100)
    }

    @Test func resistsBeyondTravelDownwardsAndSideways() {
        let far = layout.center(for: CGSize(width: 0, height: -layout.travel - 400))
        #expect(far.y > layout.restCenter.y - layout.travel - 400)
        #expect(far.y < layout.restCenter.y - layout.travel)

        let down = layout.center(for: CGSize(width: 0, height: 300))
        #expect(down.y - layout.restCenter.y < 36)

        let side = layout.center(for: CGSize(width: 500, height: 0))
        #expect(side.x - layout.restCenter.x < layout.size.width * 0.16)
    }

    @Test(arguments: [-1000, -200, -10, 0, 10, 200, 1000] as [CGFloat])
    func rubberBandIsMonotonicAndBounded(offset: CGFloat) {
        let limit: CGFloat = 50
        let value = BubbleLayout.rubberBand(offset, limit: limit)
        #expect(abs(value) < limit)
        #expect(abs(value) <= abs(offset))
        #expect(value.sign == offset.sign || offset == 0)
        #expect(BubbleLayout.rubberBand(offset + 1, limit: limit) >= value)
    }

    @Test func swellsAsItRises() {
        #expect(layout.radius(progress: 0) == layout.restRadius)
        #expect(layout.radius(progress: 1) > layout.radius(progress: 0.5))
    }

    @Test func opensPastHalfwayOrOnAFlick() {
        let half = CGSize(width: 0, height: -layout.travel * 0.55)
        #expect(layout.shouldOpen(translation: half, predictedEndTranslation: half))

        let nudge = CGSize(width: 0, height: -40)
        #expect(!layout.shouldOpen(translation: nudge, predictedEndTranslation: nudge))

        let flick = CGSize(width: 0, height: -layout.travel)
        #expect(layout.shouldOpen(translation: nudge, predictedEndTranslation: flick))

        // A twitch that never really moved doesn't count as a flick.
        #expect(!layout.shouldOpen(translation: CGSize(width: 0, height: -10), predictedEndTranslation: flick))
    }

    @Test func acceptsTouchesOnTheBubbleOrTheBottomEdge() {
        #expect(layout.acceptsTouch(at: CGPoint(x: 201, y: 840)))
        #expect(layout.acceptsTouch(at: CGPoint(x: 10, y: 860)))
        #expect(!layout.acceptsTouch(at: CGPoint(x: 201, y: 300)))
    }

    @Test func openBubbleCoversEveryCorner() {
        let corners = [
            CGPoint.zero,
            CGPoint(x: layout.size.width, y: 0),
            CGPoint(x: 0, y: layout.size.height),
            CGPoint(x: layout.size.width, y: layout.size.height),
        ]
        for corner in corners {
            let distance = hypot(corner.x - layout.openCenter.x, corner.y - layout.openCenter.y)
            #expect(distance < layout.openRadius)
        }
    }

    @Test func fullyOpenFrameIsTheSignInScreen() {
        let frame = layout.frame(drag: CGSize(width: 30, height: -400), stretch: 0.1, opened: 1, time: 3, reduceMotion: false)
        #expect(frame.center == layout.openCenter)
        #expect(frame.radius == layout.openRadius)
        #expect(frame.scale == CGSize(width: 1, height: 1))
        #expect(frame.bobbleCenter == layout.heroCenter)
        #expect(frame.portalFill == 1)
        #expect(frame.cheer == 1)
        #expect(frame.lensStrength == 0)
        #expect(frame.rimOpacity == 0)
        #expect(frame.hintOpacity == 0)
    }

    @Test func reduceMotionCrossfadesInsteadOfExpanding() {
        let frame = layout.frame(drag: .zero, stretch: 0, opened: 0.5, time: 0, reduceMotion: true)
        #expect(frame.radius == layout.openRadius)
        #expect(frame.portalFill == 0.5)
        #expect(frame.rimOpacity == 0)
    }

    @Test func stretchIsVolumePreservingAndCapped() {
        #expect(BubbleLayout.stretch(forVelocity: CGSize(width: 0, height: -100_000)) == 0.16)
        let scale = BubbleLayout.scale(forStretch: 0.1)
        #expect(scale.height > 1)
        #expect(scale.width < 1)
    }
}
