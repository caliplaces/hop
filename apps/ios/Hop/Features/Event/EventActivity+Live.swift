import ActivityKit
import Foundation

/// Shows Event mode on the Lock Screen and in the Dynamic Island.
protocol EventActivityControlling {
    func start(_ attributes: EventActivityAttributes)
    func update(_ state: EventActivityAttributes.ContentState) async
    /// Ends every Event mode Live Activity, including any left behind.
    func end() async
}

/// The real Live Activity, through ActivityKit. Event mode works the same
/// without one, when someone has turned Live Activities off.
struct LiveEventActivity: EventActivityControlling {
    func start(_ attributes: EventActivityAttributes) {
        guard ActivityAuthorizationInfo().areActivitiesEnabled else { return }
        do {
            _ = try Activity.request(
                attributes: attributes,
                content: ActivityContent(state: .init(clips: 0, latest: nil), staleDate: nil)
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
}
