import Foundation
import Observation

/// Whether someone is signed in.
///
/// Signing in with a Caliplaces account needs the API's native sign-in, which
/// isn't built yet. Until then this only remembers a local flag, so the app's
/// screens can be explored on the simulator.
@Observable
final class Session {
    private static let signedInKey = "session.isSignedIn"

    private let defaults: UserDefaults
    private(set) var isSignedIn: Bool

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
        isSignedIn = defaults.bool(forKey: Self.signedInKey)
    }

    func signIn() {
        isSignedIn = true
        defaults.set(true, forKey: Self.signedInKey)
    }

    func signOut() {
        isSignedIn = false
        defaults.set(false, forKey: Self.signedInKey)
    }
}
