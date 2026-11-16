import Observation
import SwiftUI
import UIKit

/// How the athlete hears of new clips: on their phones, and by email. Each
/// switch saves as it's flipped. When changes overlap, the last one wins: an
/// older reply never puts back what a newer change replaced.
@Observable
final class NewClipsSettings {
    private(set) var push: Bool
    private(set) var email: Bool
    /// Why the last change didn't save, if it didn't.
    private(set) var problem: String?
    /// Bumped by each change, so only the latest one's reply counts.
    private var generation = 0

    init(me: Me) {
        push = me.pushNewClips
        email = me.emailNewClips
    }

    func setPush(_ on: Bool, api: APIClient, publish: (Me) -> Void) async {
        let before = push
        push = on
        await save(Changes(pushNewClips: on), api: api, publish: publish) { self.push = before }
    }

    func setEmail(_ on: Bool, api: APIClient, publish: (Me) -> Void) async {
        let before = email
        email = on
        await save(Changes(emailNewClips: on), api: api, publish: publish) { self.email = before }
    }

    private func save(
        _ changes: Changes,
        api: APIClient,
        publish: (Me) -> Void,
        undo: () -> Void
    ) async {
        generation += 1
        let mine = generation
        problem = nil
        do {
            let reply: Reply = try await api.patch("api/me", body: changes)
            guard mine == generation else { return }
            push = reply.me.pushNewClips
            email = reply.me.emailNewClips
            publish(reply.me)
        } catch {
            guard mine == generation else { return }
            undo()
            problem = error.localizedDescription
        }
    }

    /// Only the setting that changed; the other is left out, not sent.
    private struct Changes: Encodable {
        var pushNewClips: Bool?
        var emailNewClips: Bool?
    }

    private struct Reply: Decodable {
        let me: Me
    }
}

/// The account's "New Clips" section: notifications and email, and a way to
/// allow notifications when iOS doesn't yet.
struct NewClipsSection: View {
    @Environment(Session.self) private var session
    @Environment(\.openURL) private var openURL
    @State private var settings: NewClipsSettings
    @State private var notifications = PushNotifications.shared
    private let hasEmail: Bool

    init(me: Me) {
        _settings = State(initialValue: NewClipsSettings(me: me))
        hasEmail = me.email != nil
    }

    var body: some View {
        Section {
            Toggle("Notifications", isOn: Binding(
                get: { settings.push },
                set: { on in change { await settings.setPush(on, api: $0, publish: $1) } }
            ))
            .tint(accent)
            if settings.push {
                switch notifications.authorization {
                case .notDetermined:
                    Button("Allow Notifications") { Task { await notifications.ask() } }
                case .denied:
                    Button("Allow in Settings") {
                        if let url = URL(string: UIApplication.openNotificationSettingsURLString) {
                            openURL(url)
                        }
                    }
                default:
                    EmptyView()
                }
            }
            if hasEmail {
                Toggle("Email", isOn: Binding(
                    get: { settings.email },
                    set: { on in change { await settings.setEmail(on, api: $0, publish: $1) } }
                ))
                .tint(accent)
            }
        } header: {
            Text("New Clips")
        } footer: {
            if let problem = settings.problem {
                Text(problem).foregroundStyle(.red)
            } else {
                Text("A burst of clips comes as one, once uploads go quiet.")
            }
        }
    }

    /// On, a switch takes the athlete's colour: the sheet's neutral tint
    /// would be white on white.
    private var accent: Color { (session.me?.paletteColor ?? Palette.brand).color }

    /// Saves with the session signed in now; its reply only updates that one.
    private func change(_ save: @escaping (APIClient, (Me) -> Void) async -> Void) {
        let session = session
        let token = session.token
        let api = session.api
        Task { await save(api) { session.update($0, from: token) } }
    }
}
