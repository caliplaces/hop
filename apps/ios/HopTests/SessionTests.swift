import Foundation
import Testing
@testable import Hop

private let me = meJSON()

@MainActor
@Suite("Session", .serialized)
struct SessionTests {
    let store = MemoryTokenStore()
    let server = StubServer(host: "session.test")

    /// Defaults for an app that has run before; see `freshInstallStartsSignedOut`.
    private func installedDefaults() -> UserDefaults {
        let defaults = UserDefaults(suiteName: "SessionTests.\(UUID().uuidString)")!
        defaults.set(true, forKey: "session.installed")
        return defaults
    }

    private func makeSession(
        store: MemoryTokenStore? = nil, defaults: UserDefaults? = nil
    ) -> Session {
        return Session(
            store: store ?? self.store, baseURL: server.baseURL,
            urlSession: server.urlSession(),
            defaults: defaults ?? installedDefaults()
        )
    }

    @Test func signsInThroughTheAPI() async throws {
        server.reply = { request in
            switch request.url?.path {
            case "/api/auth/app/start":
                (200, #"{"authorizeUrl":"https://auth.test/authorize?state=s","flow":"signed.flow"}"#)
            case "/api/auth/app/session":
                (200, #"{"token":"tok_123","expiresAt":1,"me":\#(me)}"#)
            default:
                (404, "{}")
            }
        }
        let session = makeSession()
        var shown: URL?
        var awaited: SignInCallback?
        try await session.signIn { url, callback in
            shown = url
            awaited = callback
            return URL(string: "com.onmyhop.app:/auth/callback?code=c&state=s")!
        }

        #expect(shown?.absoluteString == "https://auth.test/authorize?state=s")
        // A server that doesn't name a callback uses the custom scheme.
        #expect(awaited == .scheme("com.onmyhop.app"))
        #expect(session.isSignedIn)
        #expect(session.me?.handle == "alex")
        #expect(store.token == "tok_123")

        let exchange = try #require(server.requests.last)
        #expect(exchange.request.httpMethod == "POST")
        #expect(exchange.request.value(forHTTPHeaderField: "Content-Type") == "application/json")
        let sent = try JSONSerialization.jsonObject(with: exchange.body) as? [String: String]
        #expect(sent == [
            "flow": "signed.flow",
            "callbackUrl": "com.onmyhop.app:/auth/callback?code=c&state=s",
        ])
    }

    @Test func waitsForTheHTTPSCallbackTheAPINames() async throws {
        let host = server.baseURL.host() ?? ""
        let callback = Locked(#"{"host":"\#(host)","path":"/api/auth/app/callback"}"#)
        server.reply = { request in
            switch request.url?.path {
            case "/api/auth/app/start":
                (200, #"{"authorizeUrl":"https://auth.test/authorize","flow":"f","callback":\#(callback.value)}"#)
            case "/api/auth/app/session":
                (200, #"{"token":"tok_123","expiresAt":1,"me":\#(me)}"#)
            default:
                (404, "{}")
            }
        }
        let session = makeSession()
        var awaited: SignInCallback?
        try await session.signIn { _, expected in
            awaited = expected
            return URL(string: "https://\(host)/api/auth/app/callback?code=c&state=s")!
        }
        #expect(awaited == .https(host: host, path: "/api/auth/app/callback"))
        #expect(session.isSignedIn)
    }

    @Test func onlyWaitsForHopsOwnCallbacks() async {
        let callback = Locked(#"{"host":"evil.example","path":"/callback"}"#)
        server.reply = { request in
            request.url?.path == "/api/auth/app/start"
                ? (200, #"{"authorizeUrl":"https://auth.test/authorize","flow":"f","callback":\#(callback.value)}"#)
                : (404, "{}")
        }
        let session = makeSession()
        let host = server.baseURL.host() ?? ""
        for other in [
            #"{"host":"evil.example","path":"/api/auth/app/callback"}"#,
            #"{"host":"\#(host)","path":"/somewhere/else"}"#,
            #"{"scheme":"com.evil.app"}"#,
        ] {
            callback.value = other
            var asked = false
            await #expect(throws: URLError(.badServerResponse)) {
                try await session.signIn { url, _ in
                    asked = true
                    return url
                }
            }
            #expect(!asked)
        }
        #expect(!session.isSignedIn)
    }

    @Test func passesOnTheAPIsExplanation() async {
        server.reply = { _ in
            (400, #"{"error":"expired","message":"Signing in took too long."}"#)
        }
        let session = makeSession()
        await #expect(throws: APIError(status: 400, code: "expired", message: "Signing in took too long.")) {
            try await session.signIn { url, _ in url }
        }
        #expect(!session.isSignedIn)
        #expect(store.token == nil)
    }

    @Test func remembersTheTokenAndSignsRequestsWithIt() async throws {
        server.reply = { _ in (200, #"{"me":\#(me)}"#) }
        let session = makeSession(store: MemoryTokenStore("tok_saved"))
        #expect(session.isSignedIn)
        await session.refresh()
        #expect(session.me?.name == "Alex Rider")
        let request = try #require(server.requests.last?.request)
        #expect(request.value(forHTTPHeaderField: "Authorization") == "Bearer tok_saved")
    }

    @Test func signsOutWhenTheServerForgotTheSession() async {
        server.reply = { _ in (200, #"{"me":null}"#) }
        let saved = MemoryTokenStore("tok_old")
        let session = makeSession(store: saved)
        await session.refresh()
        #expect(!session.isSignedIn)
        #expect(saved.token == nil)
    }

    @Test func staysSignedInWhileOffline() async {
        server.reply = { _ in (503, "{}") }
        let session = makeSession(store: MemoryTokenStore("tok_saved"))
        await session.refresh()
        #expect(session.isSignedIn)
    }

    @Test func ignoresARefreshOvertakenBySignOutAndBackIn() async throws {
        server.held = ["/api/me"]
        server.reply = { request in
            switch request.url?.path {
            case "/api/me": (200, #"{"me":null}"#)
            case "/api/auth/app/start":
                (200, #"{"authorizeUrl":"https://auth.test/authorize","flow":"f"}"#)
            case "/api/auth/app/session":
                (200, #"{"token":"tok_new","expiresAt":1,"me":\#(me)}"#)
            default: (200, #"{"ok":true}"#)
            }
        }
        let saved = MemoryTokenStore("tok_old")
        let session = makeSession(store: saved)

        // The launch-time refresh is still on its way when the person signs
        // out and back in; its stale "signed out" reply must not win.
        let refreshing = Task { await session.refresh() }
        try await server.waitForRequest("/api/me")
        await session.signOut()
        try await session.signIn { _, _ in URL(string: "com.onmyhop.app:/auth/callback?code=c&state=s")! }
        server.release()
        await refreshing.value

        #expect(session.token == "tok_new")
        #expect(saved.token == "tok_new")
        #expect(session.me?.handle == "alex")
    }

    @Test func dropsAProfileFromASessionThatWasReplaced() async throws {
        server.reply = { request in
            switch request.url?.path {
            case "/api/auth/app/start":
                (200, #"{"authorizeUrl":"https://auth.test/authorize","flow":"f"}"#)
            case "/api/auth/app/session":
                (200, #"{"token":"tok_new","expiresAt":1,"me":\#(me)}"#)
            default: (200, #"{"ok":true}"#)
            }
        }
        let session = makeSession(store: MemoryTokenStore("tok_old"))
        let asked = session.token
        await session.signOut()
        try await session.signIn { _, _ in URL(string: "com.onmyhop.app:/auth/callback?code=c&state=s")! }

        let stale = try JSONDecoder().decode(Me.self, from: Data(meJSON(handle: "someoneelse").utf8))
        session.update(stale, from: asked)
        #expect(session.me?.handle == "alex")
        session.update(stale, from: nil)
        #expect(session.me?.handle == "alex")
        session.update(stale, from: session.token)
        #expect(session.me?.handle == "someoneelse")
    }

    @Test func storesTokensPerServerIncludingThePort() {
        let keys = [
            "https://onmyhop.com",
            "https://staging.onmyhop.com",
            "http://127.0.0.1:8787",
            "http://127.0.0.1:8788",
        ].map { HopServer.storageKey(for: URL(string: $0)!) }
        #expect(Set(keys).count == keys.count)
        #expect(keys[2] == "http://127.0.0.1:8787")
    }

    @Test func keychainDeleteAllClearsEveryServer() throws {
        let service = "com.onmyhop.app.tests.\(UUID().uuidString)"
        let staging = KeychainTokenStore(service: service, account: "https://staging.onmyhop.com")
        let production = KeychainTokenStore(service: service, account: "https://onmyhop.com")
        try staging.write("tok_staging")
        try production.write("tok_production")
        #expect(staging.read() == "tok_staging")
        staging.deleteAll()
        #expect(staging.read() == nil)
        #expect(production.read() == nil)
    }

    @Test func freshInstallStartsSignedOut() {
        let saved = MemoryTokenStore("tok_from_before_uninstall")
        let fresh = UserDefaults(suiteName: "SessionTests.\(UUID().uuidString)")!
        let session = makeSession(store: saved, defaults: fresh)
        #expect(!session.isSignedIn)
        #expect(saved.token == nil)
        #expect(fresh.bool(forKey: "session.installed"))
    }

    @Test(arguments: [
        ("https://staging.onmyhop.com", true),
        ("http://127.0.0.1:8787", true),
        ("http://localhost:8787", true),
        ("http://example.com", false),
        ("ftp://127.0.0.1", false),
    ])
    func serverOverridesMustBeSecureOrLocal(url: String, allowed: Bool) {
        #expect(HopServer.isAllowedOverride(URL(string: url)!) == allowed)
    }

    @Test func signOutForgetsLocallyAndEndsTheServerSession() async throws {
        server.reply = { _ in (200, #"{"ok":true}"#) }
        let saved = MemoryTokenStore("tok_saved")
        let session = makeSession(store: saved)
        await session.signOut()
        #expect(!session.isSignedIn)
        #expect(saved.token == nil)
        let request = try #require(server.requests.last?.request)
        #expect(request.url?.path == "/api/auth/logout")
        #expect(request.value(forHTTPHeaderField: "Authorization") == "Bearer tok_saved")
        #expect(request.value(forHTTPHeaderField: "Content-Type") == "application/json")
    }
}
