import Observation
import SwiftUI
import UIKit

/// How the athlete hears of new clips: on their phones, and by email. Each
/// switch saves as it's flipped, one save at a time: a flip made while one
/// is on its way goes next, so the server always ends up with the last one.
@Observable
final class NewClipsSettings {
    /// What the switches show: what the athlete wants.
    private(set) var push: Bool
    private(set) var email: Bool
    /// Why the last change didn't save, if it didn't.
    private(set) var problem: String?
    /// What the server has, as far as its replies tell.
    private var saved: (push: Bool, email: Bool)
    private var saving = false

    init(me: Me) {
        push = me.pushNewClips
        email = me.emailNewClips
        saved = (me.pushNewClips, me.emailNewClips)
    }

    func setPush(_ on: Bool, api: APIClient, publish: (Me) -> Void) async {
        push = on
        await save(api: api, publish: publish)
    }

    func setEmail(_ on: Bool, api: APIClient, publish: (Me) -> Void) async {
        email = on
        await save(api: api, publish: publish)
    }

    /// Sends what differs from the server until nothing does. A save already
    /// under way picks up later flips itself.
    private func save(api: APIClient, publish: (Me) -> Void) async {
        guard !saving else { return }
        saving = true
        defer { saving = false }
        problem = nil
        while push != saved.push || email != saved.email {
            let sent = (push: push, email: email)
            let changes = Changes(
                pushNewClips: push != saved.push ? push : nil,
                emailNewClips: email != saved.email ? email : nil
            )
            do {
                let reply: Reply = try await api.patch("api/me", body: changes)
                saved = (reply.me.pushNewClips, reply.me.emailNewClips)
                // A switch not flipped meanwhile shows what the server has,
                // which may be a change made on another device.
                if push == sent.push { push = saved.push }
                if email == sent.email { email = saved.email }
                publish(reply.me)
            } catch {
                // Only what this save carried goes back; a flip made since
                // still goes next.
                if push == sent.push { push = saved.push }
                if email == sent.email { email = saved.email }
                problem = error.localizedDescription
            }
        }
    }

    /// Only the settings that changed; the others are left out, not sent.
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
