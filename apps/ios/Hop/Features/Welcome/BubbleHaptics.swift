import CoreHaptics

/// How the bubble feels: a hum that swells as it grows, a click when letting go
/// would open it, and a pop when it does. Silent where haptics aren't supported,
/// like the simulator.
final class BubbleHaptics {
    private let engine: CHHapticEngine?
    private var hum: CHHapticAdvancedPatternPlayer?

    init() {
        guard CHHapticEngine.capabilitiesForHardware().supportsHaptics else {
            engine = nil
            return
        }
        engine = try? CHHapticEngine()
        // Stops when idle, so the engine is started again on each touch.
        engine?.isAutoShutdownEnabled = true
    }

    /// A finger landed on the bubble: start the hum.
    func begin() {
        guard let engine else { return }
        do {
            try engine.start()
            let event = CHHapticEvent(
                eventType: .hapticContinuous,
                parameters: [
                    CHHapticEventParameter(parameterID: .hapticIntensity, value: 1),
                    CHHapticEventParameter(parameterID: .hapticSharpness, value: 0.3),
                ],
                relativeTime: 0,
                duration: 30
            )
            let player = try engine.makeAdvancedPlayer(with: CHHapticPattern(events: [event], parameters: []))
            try player.start(atTime: CHHapticTimeImmediate)
            hum = player
            update(progress: 0)
        } catch {
            hum = nil
        }
    }

    /// The hum grows stronger and crisper as the bubble swells.
    func update(progress: CGFloat) {
        let p = Float(min(max(progress, 0), 1))
        try? hum?.sendParameters(
            [
                CHHapticDynamicParameter(parameterID: .hapticIntensityControl, value: 0.06 + 0.5 * p * p, relativeTime: 0),
                CHHapticDynamicParameter(parameterID: .hapticSharpnessControl, value: 0.1 + 0.45 * p, relativeTime: 0),
            ],
            atTime: CHHapticTimeImmediate
        )
    }

    /// Letting go now would open the bubble.
    func click() {
        play([transient(intensity: 0.75, sharpness: 0.85)])
    }

    /// A tap on the bubble, which hops to show it can be swiped.
    func tap() {
        play([transient(intensity: 0.45, sharpness: 0.5)])
    }

    /// The finger lifted: a pop if the bubble opens, a soft bump if it falls back.
    func end(opened: Bool) {
        try? hum?.stop(atTime: CHHapticTimeImmediate)
        hum = nil
        if opened {
            play(
                [
                    transient(intensity: 1, sharpness: 0.6),
                    CHHapticEvent(
                        eventType: .hapticContinuous,
                        parameters: [
                            CHHapticEventParameter(parameterID: .hapticIntensity, value: 0.6),
                            CHHapticEventParameter(parameterID: .hapticSharpness, value: 0.15),
                        ],
                        relativeTime: 0.02,
                        duration: 0.35
                    ),
                ],
                curves: [
                    CHHapticParameterCurve(
                        parameterID: .hapticIntensityControl,
                        controlPoints: [
                            .init(relativeTime: 0, value: 1),
                            .init(relativeTime: 0.35, value: 0),
                        ],
                        relativeTime: 0.02
                    ),
                ]
            )
        } else {
            play([transient(intensity: 0.35, sharpness: 0.3)])
        }
    }

    private func transient(intensity: Float, sharpness: Float) -> CHHapticEvent {
        CHHapticEvent(
            eventType: .hapticTransient,
            parameters: [
                CHHapticEventParameter(parameterID: .hapticIntensity, value: intensity),
                CHHapticEventParameter(parameterID: .hapticSharpness, value: sharpness),
            ],
            relativeTime: 0
        )
    }

    private func play(_ events: [CHHapticEvent], curves: [CHHapticParameterCurve] = []) {
        guard let engine else { return }
        do {
            try engine.start()
            let pattern = try CHHapticPattern(events: events, parameterCurves: curves)
            try engine.makePlayer(with: pattern).start(atTime: CHHapticTimeImmediate)
        } catch {
            // Haptics are a nicety; the bubble works without them.
        }
    }
}
