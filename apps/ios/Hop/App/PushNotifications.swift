import Observation
import SwiftUI
import UIKit
import UserNotifications

/// Notifications on this phone, such as free-plan clips about to go (see
/// "Free-plan expiry" in apps/api/README.md). Hop asks once, from a card in
/// the inbox rather than at launch, and keeps the API told of this install's
/// push token while someone is signed in.
@Observable
final class PushNotifications: NSObject {
    static let shared = PushNotifications()

    private(set) var authorization: UNAuthorizationStatus = .notDetermined
    /// The card asking was put away.
    private(set) var askDismissed: Bool

    private let defaults: UserDefaults
    private let center: NotificationCenterProtocol
    private let registerWithApple: @MainActor () -> Void
    /// The signed-in session's client, to send a token to when Apple hands one over.
    private var api: APIClient?

    private static let tokenKey = "push.token"
    private static let dismissedKey = "push.askDismissed"

    init(
        defaults: UserDefaults = .standard,
        center: NotificationCenterProtocol = UNUserNotificationCenter.current(),
        registerWithApple: @escaping @MainActor () -> Void = { UIApplication.shared.registerForRemoteNotifications() }
    ) {
        self.defaults = defaults
        self.center = center
        self.registerWithApple = registerWithApple
        askDismissed = defaults.bool(forKey: Self.dismissedKey)
    }

    /// This install's push token, as hex, once Apple has given one.
    var token: String? { defaults.string(forKey: Self.tokenKey) }

    /// Whether to show the card asking: nobody has been asked yet, and it
    /// wasn't put away.
    var shouldAsk: Bool { authorization == .notDetermined && !askDismissed }

    /// For a signed-in session: reads whether notifications are allowed, and
    /// if they are, asks Apple for the token (again each launch, as it can
    /// change), which reaches the API through `received(_:)`.
    func start(api: APIClient) async {
        self.api = api
        authorization = await center.authorizationStatus()
        if authorization == .authorized || authorization == .provisional {
            registerWithApple()
        }
    }

    /// Signed out: no more sending tokens anywhere.
    func stop() {
        api = nil
    }

    /// From the card: asks, and registers if allowed.
    @discardableResult
    func ask() async -> Bool {
        let allowed = (try? await center.requestAuthorization(options: [.alert, .sound, .badge])) ?? false
        authorization = await center.authorizationStatus()
        if allowed { registerWithApple() }
        return allowed
    }

    func dismissAsk() {
        askDismissed = true
        defaults.set(true, forKey: Self.dismissedKey)
    }

    /// Apple's token for this install: kept, and sent to the API.
    func received(_ deviceToken: Data) async {
        let hex = deviceToken.map { String(format: "%02x", $0) }.joined()
        defaults.set(hex, forKey: Self.tokenKey)
        guard let api else { return }
        await upload(hex, api: api)
    }

    /// Tells the API this install's token belongs to the signed-in athlete.
    func upload(_ hex: String, api: APIClient) async {
        do {
            let _: Done = try await api.put(
                "api/me/devices/\(hex)",
                body: DeviceBody(environment: EventMode.pushEnvironment)
            )
        } catch let error as APIError where error.code == "wrong_environment" {
            // A debug build against production, say: it can't be pushed to.
        } catch {
            // Offline: sent again next launch.
        }
    }

    /// Before signing out: this phone stops getting the athlete's
    /// notifications. Best effort; the session ends either way.
    func unregister(api: APIClient) async {
        stop()
        guard let token else { return }
        try? await api.delete("api/me/devices/\(token)")
    }

    private struct DeviceBody: Encodable {
        let environment: String
    }

    private struct Done: Decodable {}
}

extension PushNotifications: UNUserNotificationCenterDelegate {
    /// Shown even while Hop is open.
    nonisolated func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification
    ) async -> UNNotificationPresentationOptions {
        [.banner, .list, .sound]
    }
}

/// What PushNotifications needs of the notification center, so tests can
/// stand in for it.
protocol NotificationCenterProtocol: Sendable {
    func authorizationStatus() async -> UNAuthorizationStatus
    func requestAuthorization(options: UNAuthorizationOptions) async throws -> Bool
}

extension UNUserNotificationCenter: NotificationCenterProtocol {
    func authorizationStatus() async -> UNAuthorizationStatus {
        await notificationSettings().authorizationStatus
    }
}

/// Hands Apple's push token to PushNotifications, and makes it the
/// notification center's delegate.
final class AppDelegate: NSObject, UIApplicationDelegate {
    func application(
        _ application: UIApplication,
        didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
    ) -> Bool {
        UNUserNotificationCenter.current().delegate = PushNotifications.shared
        return true
    }

    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        Task { await PushNotifications.shared.received(deviceToken) }
    }

    func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: any Error) {
        // The simulator without a paired push setup, say: nothing to send.
    }
}

/// The card in the inbox asking to turn notifications on, once.
struct NotificationsNudge: View {
    /// The athlete's colour, for the button.
    let color: PaletteColor
    @State private var push = PushNotifications.shared

    var body: some View {
        if push.shouldAsk {
            VStack(alignment: .leading, spacing: 12) {
                HStack(alignment: .top, spacing: 14) {
                    Image(systemName: "bell.badge")
                        .font(.title2)
                        .foregroundStyle(Theme.ink)
                        .symbolRenderingMode(.hierarchical)
                    VStack(alignment: .leading, spacing: 3) {
                        Text("Hear before clips go")
                            .font(.subheadline.weight(.semibold))
                            .foregroundStyle(Theme.ink)
                        Text("On the free plan, clips are kept 30 days. Hop tells you a week before any go, and the day before.")
                            .font(.footnote)
                            .foregroundStyle(Theme.muted)
                    }
                }
                HStack(spacing: 10) {
                    Button { Task { await push.ask() } } label: {
                        Text("Turn On").foregroundStyle(color.onColor)
                    }
                    .buttonStyle(.glassProminent)
                    .tint(color.color)
                    Button("Not Now") { push.dismissAsk() }
                        .buttonStyle(.glass)
                }
                .controlSize(.small)
            }
            .padding(16)
            .frame(maxWidth: .infinity, alignment: .leading)
            .glassEffect(.regular, in: .rect(cornerRadius: 22))
            .transition(.opacity)
        }
    }
}
