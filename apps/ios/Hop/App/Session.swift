import Foundation
import Observation

/// Who is signed in, and signing in and out with a Caliplaces account.
///
/// Sign-in runs in three steps. Hop's API starts a flow and returns
/// Caliplaces' sign-in URL. The app shows that page in a web authentication
/// session. Then it hands the URL Caliplaces redirected back to over to the
/// API, which trades the code for a Hop session. The app only ever holds that
/// session token, in the Keychain.
@Observable
final class Session {
    private(set) var me: Me?
    private(set) var token: String?

    var isSignedIn: Bool { token != nil }

    private let store: TokenStore
    private let baseURL: URL
    private let urlSession: URLSession

    init(
        store: TokenStore = KeychainTokenStore(),
        baseURL: URL = HopServer.baseURL,
        urlSession: URLSession = .shared
    ) {
        self.store = store
        self.baseURL = baseURL
        self.urlSession = urlSession
        token = store.read()
    }

    private var api: APIClient {
        APIClient(baseURL: baseURL, token: token, session: urlSession)
    }

    /// Signs in with Caliplaces.
    /// - Parameter authenticate: Shows Caliplaces' sign-in page at the given
    ///   URL and returns the URL it redirects back to.
    func signIn(authenticate: (URL) async throws -> URL) async throws {
        let start: StartReply = try await api.post("api/auth/app/start", body: Empty())
        guard let url = URL(string: start.authorizeUrl) else { throw URLError(.badURL) }
        let callback = try await authenticate(url)
        let reply: SessionReply = try await api.post(
            "api/auth/app/session",
            body: SessionRequest(flow: start.flow, callbackUrl: callback.absoluteString)
        )
        try store.write(reply.token)
        token = reply.token
        me = reply.me
    }

    /// Reloads the profile. Signs out here if the server no longer knows the
    /// session; keeps it when offline.
    func refresh() async {
        guard token != nil else { return }
        do {
            let reply: MeReply = try await api.get("api/me")
            if let me = reply.me {
                self.me = me
            } else {
                forget()
            }
        } catch {
            // Offline or the server is having a moment: try again next launch.
        }
    }

    /// Signs out at once, then tells the server to end the session.
    func signOut() async {
        let client = api
        forget()
        try? await client.post("api/auth/logout")
    }

    private func forget() {
        store.delete()
        token = nil
        me = nil
    }

    private struct Empty: Encodable {}

    private struct StartReply: Decodable {
        let authorizeUrl: String
        let flow: String
    }

    private struct SessionRequest: Encodable {
        let flow: String
        let callbackUrl: String
    }

    private struct SessionReply: Decodable {
        let token: String
        let me: Me
    }

    private struct MeReply: Decodable {
        let me: Me?
    }
}
