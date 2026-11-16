import ActivityKit
import Foundation

/// Shows Event mode on the Lock Screen and in the Dynamic Island.
protocol EventActivityControlling {
    func start(_ attributes: EventActivityAttributes)
    func update(_ state: EventActivityAttributes.ContentState) async
    /// Ends every Event mode Live Activity, including any left behind.
    func end() async
    /// The running Live Activity's push tokens, as hex: the current one, then
    /// each new one Apple issues. Finishes when there's no Live Activity.
    func pushTokens() -> AsyncStream<String>
}

/// The real Live Activity, through ActivityKit. Event mode works the same
/// without one, when someone has turned Live Activities off.
struct LiveEventActivity: EventActivityControlling {
    func start(_ attributes: EventActivityAttributes) {
        guard ActivityAuthorizationInfo().areActivitiesEnabled else { return }
        do {
            _ = try Activity.request(
                attributes: attributes,
                content: ActivityContent(state: .init(clips: 0, latest: nil), staleDate: nil),
                // So the API can update it while the phone is locked.
                pushType: .token
            )
        } catch {
            // Turned off, or too many running: Event mode carries on without it.
        }
    }

    func update(_ state: EventActivityAttributes.ContentState) async {
        for activity in Activity<EventActivityAttributes>.activities {
            await activity.update(ActivityContent(state: state, staleDate: nil))
        }
    }

    func end() async {
        for activity in Activity<EventActivityAttributes>.activities {
            await activity.end(nil, dismissalPolicy: .immediate)
        }
    }

    func pushTokens() -> AsyncStream<String> {
        AsyncStream { continuation in
            guard let activity = Activity<EventActivityAttributes>.activities.first else {
                continuation.finish()
                return
            }
            let following = Task {
                if let token = activity.pushToken { continuation.yield(token.hex) }
                for await token in activity.pushTokenUpdates { continuation.yield(token.hex) }
                continuation.finish()
            }
            continuation.onTermination = { _ in following.cancel() }
        }
    }
}

private extension Data {
    /// Lowercase hex, as APNs takes device and push tokens.
    var hex: String { map { String(format: "%02x", $0) }.joined() }
}
