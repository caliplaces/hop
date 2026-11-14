import SwiftUI

/// The first screen: a bubble peeking up from the bottom edge. Swipe it up and
/// it follows the finger, swells, fills with colour and, once let go past
/// halfway, opens into the sign-in screen.
struct WelcomeView: View {
    private enum Phase { case resting, dragging, opening, open }

    @State private var phase = Phase.resting
    @State private var drag = CGSize.zero
    @State private var stretch: CGFloat = 0
    @State private var opened: CGFloat = 0
    /// Whether letting go now would open the bubble.
    @State private var armed = false
    /// Bumped by each tap hint and each drag, so a hint that is still
    /// running can tell it has been overtaken and leave the bubble alone.
    @State private var hintID = 0
    /// How far the sign-in screen is scrolled, so Bobble scrolls with it.
    @State private var signInScroll: CGFloat = 0
    @State private var haptics = BubbleHaptics()

    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        // The scene spans the whole screen but still needs the safe area, which
        // a reader that ignores it would report as zero.
        GeometryReader { proxy in
            let insets = proxy.safeAreaInsets
            let size = CGSize(
                width: proxy.size.width + insets.leading + insets.trailing,
                height: proxy.size.height + insets.top + insets.bottom
            )
            scene(BubbleLayout(size: size, insets: insets))
                .frame(width: size.width, height: size.height)
                .offset(x: -insets.leading, y: -insets.top)
        }
    }

    private func scene(_ layout: BubbleLayout) -> some View {
        ZStack {
            BubbleScene(
                layout: layout, drag: drag, stretch: stretch, opened: opened,
                scroll: signInScroll, reduceMotion: reduceMotion
            )
            if phase == .resting {
                startButton(layout)
            }
            if phase == .open {
                SignInPanel(layout: layout, onClose: close, onScroll: { signInScroll = $0 })
                    .transition(.opacity.combined(with: .offset(y: 20)))
            }
        }
        .contentShape(Rectangle())
        .gesture(dragGesture(layout), isEnabled: phase == .resting || phase == .dragging)
        .onTapGesture(coordinateSpace: .local) { location in
            if phase == .resting, layout.acceptsTouch(at: location) { hint() }
        }
    }

    /// VoiceOver and Switch Control open the bubble with a single action.
    private func startButton(_ layout: BubbleLayout) -> some View {
        Color.clear
            .frame(width: layout.restRadius * 2, height: layout.restRadius)
            .position(x: layout.restCenter.x, y: layout.size.height - layout.restRadius / 2)
            .accessibilityElement()
            .accessibilityLabel("Get started")
            .accessibilityHint("Opens sign-in.")
            .accessibilityAddTraits(.isButton)
            .accessibilityAction { open() }
            .allowsHitTesting(false)
    }

    private func dragGesture(_ layout: BubbleLayout) -> some Gesture {
        DragGesture(minimumDistance: 6)
            .onChanged { value in
                if phase == .resting {
                    guard layout.acceptsTouch(at: value.startLocation) else { return }
                    phase = .dragging
                    armed = false
                    hintID += 1
                    haptics.begin()
                }
                guard phase == .dragging else { return }
                drag = value.translation
                let progress = layout.progress(for: value.translation)
                haptics.update(progress: progress)
                let canOpen = progress >= BubbleLayout.openThreshold
                if canOpen != armed {
                    armed = canOpen
                    if canOpen { haptics.click() }
                }
                // Ease towards the target so the stretch doesn't jitter.
                stretch += (BubbleLayout.stretch(forVelocity: value.velocity) - stretch) * 0.3
            }
            .onEnded { value in
                guard phase == .dragging else { return }
                if layout.shouldOpen(
                    translation: value.translation,
                    predictedEndTranslation: value.predictedEndTranslation
                ) {
                    open()
                } else {
                    haptics.end(opened: false)
                    phase = .resting
                    // A bouncy spring, so the bubble wobbles like jelly as it settles.
                    withAnimation(.spring(duration: 0.6, bounce: 0.45)) {
                        drag = .zero
                        stretch = 0
                    }
                }
            }
    }

    private func open() {
        phase = .opening
        haptics.end(opened: true)
        let animation: Animation = reduceMotion
            ? .easeInOut(duration: 0.4)
            : .spring(duration: 0.85, bounce: 0.12)
        withAnimation(animation) {
            opened = 1
            stretch = 0
        }
        // Sign-in fades in while the bubble is still settling, not after.
        withAnimation(.smooth(duration: 0.45).delay(reduceMotion ? 0.15 : 0.35)) {
            phase = .open
        }
    }

    private func close() {
        withAnimation(.smooth(duration: 0.2)) {
            phase = .opening
            signInScroll = 0
        }
        let animation: Animation = reduceMotion
            ? .easeInOut(duration: 0.35)
            : .spring(duration: 0.75, bounce: 0.1)
        withAnimation(animation) {
            opened = 0
            drag = .zero
        } completion: {
            phase = .resting
        }
    }

    /// A tap makes the bubble hop, to show that it wants to be swiped.
    private func hint() {
        hintID += 1
        let id = hintID
        haptics.tap()
        withAnimation(.spring(duration: 0.25, bounce: 0)) {
            drag = CGSize(width: 0, height: -52)
        } completion: {
            // A drag that started meanwhile owns the bubble now.
            guard id == hintID, phase == .resting else { return }
            withAnimation(.spring(duration: 0.7, bounce: 0.5)) { drag = .zero }
        }
    }
}

/// Draws one frame of the welcome bubble. It's `Animatable`, so the springs on
/// `drag`, `stretch` and `opened` reach the shaders frame by frame.
struct BubbleScene: View, Animatable {
    let layout: BubbleLayout
    var drag: CGSize
    var stretch: CGFloat
    var opened: CGFloat
    /// The sign-in screen's scroll offset; Bobble moves with its content.
    let scroll: CGFloat
    let reduceMotion: Bool

    nonisolated var animatableData: AnimatablePair<
        AnimatablePair<CGFloat, CGFloat>, AnimatablePair<CGFloat, CGFloat>
    > {
        get { AnimatablePair(AnimatablePair(drag.width, drag.height), AnimatablePair(stretch, opened)) }
        set {
            drag = CGSize(width: newValue.first.first, height: newValue.first.second)
            stretch = newValue.second.first
            opened = newValue.second.second
        }
    }

    @Environment(\.colorScheme) private var colorScheme

    var body: some View {
        TimelineView(.animation(paused: reduceMotion)) { context in
            // Wrapped to keep the shaders' Float time precise.
            let time = reduceMotion
                ? 0
                : context.date.timeIntervalSinceReferenceDate.truncatingRemainder(dividingBy: 3600)
            let frame = layout.frame(
                drag: drag, stretch: stretch, opened: opened, time: time, reduceMotion: reduceMotion
            )
            // Layers that can't be seen are left out, so they cost nothing and
            // assistive technologies can't reach them.
            ZStack {
                if opened < 0.999 {
                    world(frame)
                }
                portal(frame)
                rim(frame, time: time)
                if frame.hintOpacity > 0 {
                    hint(frame)
                }
            }
        }
    }

    /// The welcome screen behind the bubble, magnified wherever the bubble is.
    private func world(_ frame: BubbleLayout.Frame) -> some View {
        WelcomeWorld(layout: layout)
            .layerEffect(
                ShaderLibrary.bubbleLens(
                    .float2(frame.center), .float(frame.radius), .float2(frame.scale),
                    .float(frame.lensStrength), .float(0.035), .float2(layout.size)
                ),
                maxSampleOffset: CGSize(width: 72, height: 72),
                isEnabled: frame.lensStrength > 0.001
            )
            .accessibilityHidden(opened > 0.5)
    }

    /// The sign-in world, seen through the bubble, with Bobble rising inside.
    private func portal(_ frame: BubbleLayout.Frame) -> some View {
        ZStack {
            Aura(colors: SignInPanel.auraColors, intensity: 1.5)
                .opacity(frame.portalFill)
            ZStack {
                if frame.cheer < 1 {
                    Image(.bobbleIdle).resizable().scaledToFit().opacity(1 - frame.cheer)
                }
                if frame.cheer > 0 {
                    Image(.bobbleCheer).resizable().scaledToFit().opacity(frame.cheer)
                }
            }
            .frame(width: frame.bobbleSize, height: frame.bobbleSize)
            .opacity(frame.bobbleOpacity)
            .position(frame.bobbleCenter)
            .offset(y: -scroll)
            .accessibilityHidden(true)
        }
        .mask {
            Ellipse()
                .frame(
                    width: frame.radius * 2 * frame.scale.width,
                    height: frame.radius * 2 * frame.scale.height
                )
                .position(frame.center)
        }
    }

    /// The bubble's skin: soap film, highlights and edge.
    private func rim(_ frame: BubbleLayout.Frame, time: Double) -> some View {
        let visible = frame.rimOpacity > 0.001
        return Rectangle()
            .fill(.white)
            .colorEffect(
                ShaderLibrary.bubbleRim(
                    .float2(frame.center), .float(frame.radius), .float2(frame.scale),
                    .float(time), .float(colorScheme == .dark ? 1 : 0), .float(frame.rimOpacity)
                ),
                isEnabled: visible
            )
            .opacity(visible ? 1 : 0)
            .allowsHitTesting(false)
            .accessibilityHidden(true)
    }

    private func hint(_ frame: BubbleLayout.Frame) -> some View {
        VStack(spacing: 2) {
            Image(systemName: "chevron.compact.up")
                .font(.system(size: 26, weight: .semibold))
                .foregroundStyle(.secondary)
            ShimmerText("Swipe up to start")
                .font(.headline)
        }
        .position(
            x: frame.center.x,
            y: frame.center.y - frame.radius * frame.scale.height * 0.66
        )
        .opacity(frame.hintOpacity)
        .accessibilityHidden(true)
    }
}

#Preview {
    WelcomeView()
        .environment(Session())
}
