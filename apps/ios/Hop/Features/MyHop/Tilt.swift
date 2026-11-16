import CoreMotion
import Foundation
import Observation

/// How the phone is tilting, -1…1 on each axis, for the Hop pass's foil.
///
/// It's relative to how the phone is being held: the resting pose slowly
/// follows it, so tilting the phone moves the foil and holding it still lets
/// it settle back, whatever the angle.
@Observable
final class Tilt {
    private(set) var value = CGPoint.zero

    @ObservationIgnored private let motion = CMMotionManager()
    @ObservationIgnored private var rest: CGPoint?

    /// Gravity this far from the resting pose is a full tilt.
    nonisolated static let range = 0.35
    /// How quickly the resting pose catches up with the phone, per update.
    nonisolated static let settle = 0.025

    func start() {
        guard motion.isDeviceMotionAvailable, !motion.isDeviceMotionActive else { return }
        motion.deviceMotionUpdateInterval = 1.0 / 60.0
        // On the main queue, so updates arrive on the main actor.
        motion.startDeviceMotionUpdates(to: .main) { [weak self] data, _ in
            guard let self, let gravity = data?.gravity else { return }
            self.update(gravity: CGPoint(x: gravity.x, y: gravity.y))
        }
    }

    func stop() {
        motion.stopDeviceMotionUpdates()
        rest = nil
        value = .zero
    }

    private func update(gravity: CGPoint) {
        let (tilt, rest) = Self.step(gravity: gravity, rest: rest ?? gravity)
        self.rest = rest
        value = tilt
    }

    /// One update: the tilt relative to the resting pose, and the resting
    /// pose moved a little towards where the phone is now.
    nonisolated static func step(gravity: CGPoint, rest: CGPoint) -> (tilt: CGPoint, rest: CGPoint) {
        let clamp = { (v: Double) in min(1, max(-1, v)) }
        let tilt = CGPoint(
            x: clamp((gravity.x - rest.x) / range),
            y: clamp((gravity.y - rest.y) / range)
        )
        let settled = CGPoint(
            x: rest.x + (gravity.x - rest.x) * settle,
            y: rest.y + (gravity.y - rest.y) * settle
        )
        return (tilt, settled)
    }
}
