import Foundation
import Testing
@testable import Hop

/// Answers requests from a closure instead of the network, and records them.
final class StubProtocol: URLProtocol {
    nonisolated(unsafe) static var reply: (URLRequest) -> (Int, String) = { _ in (404, "{}") }
    nonisolated(unsafe) static var requests: [(request: URLRequest, body: Data)] = []

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        // URLSession hands bodies to protocols as streams.
        var body = Data()
        if let stream = request.httpBodyStream {
            stream.open()
            var buffer = [UInt8](repeating: 0, count: 4096)
            while stream.hasBytesAvailable {
                let count = stream.read(&buffer, maxLength: buffer.count)
                if count <= 0 { break }
                body.append(buffer, count: count)
            }
            stream.close()
        }
        Self.requests.append((request, body))
        let (status, json) = Self.reply(request)
        let response = HTTPURLResponse(
            url: request.url!, statusCode: status, httpVersion: nil,
            headerFields: ["Content-Type": "application/json"]
        )!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: Data(json.utf8))
        client?.urlProtocolDidFinishLoading(self)
    }

    override func stopLoading() {}
}

final class MemoryTokenStore: TokenStore, @unchecked Sendable {
    var token: String?
    init(_ token: String? = nil) { self.token = token }
    func read() -> String? { token }
    func write(_ token: String) throws { self.token = token }
    func delete() { token = nil }
}

private let me = """
    {"id":"usr_1","name":"Alex Rider","email":"alex@example.com","handle":"alex",
     "activeHopId":"hop_1","color":"grape","emailNewClips":true}
    """

@MainActor
@Suite("Session", .serialized)
struct SessionTests {
    let store = MemoryTokenStore()
    let base = URL(string: "https://hop.test")!

    init() {
        StubProtocol.requests = []
    }

    /// Defaults for an app that has run before; see `freshInstallStartsSignedOut`.
    private func installedDefaults() -> UserDefaults {
        let defaults = UserDefaults(suiteName: "SessionTests.\(UUID().uuidString)")!
        defaults.set(true, forKey: "session.installed")
        return defaults
    }

    private func makeSession(
        store: MemoryTokenStore? = nil, defaults: UserDefaults? = nil
    ) -> Session {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [StubProtocol.self]
        return Session(
            store: store ?? self.store, baseURL: base,
            urlSession: URLSession(configuration: configuration),
            defaults: defaults ?? installedDefaults()
        )
    }

    @Test func signsInThroughTheAPI() async throws {
        StubProtocol.reply = { request in
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
        try await session.signIn { url in
            shown = url
            return URL(string: "com.onmyhop.app:/auth/callback?code=c&state=s")!
        }

        #expect(shown?.absoluteString == "https://auth.test/authorize?state=s")
        #expect(session.isSignedIn)
        #expect(session.me?.handle == "alex")
        #expect(store.token == "tok_123")

        let exchange = try #require(StubProtocol.requests.last)
        #expect(exchange.request.httpMethod == "POST")
        #expect(exchange.request.value(forHTTPHeaderField: "Content-Type") == "application/json")
        let sent = try JSONSerialization.jsonObject(with: exchange.body) as? [String: String]
        #expect(sent == [
            "flow": "signed.flow",
            "callbackUrl": "com.onmyhop.app:/auth/callback?code=c&state=s",
        ])
    }

    @Test func passesOnTheAPIsExplanation() async {
        StubProtocol.reply = { _ in
            (400, #"{"error":"expired","message":"Signing in took too long."}"#)
        }
        let session = makeSession()
        await #expect(throws: APIError(status: 400, code: "expired", message: "Signing in took too long.")) {
            try await session.signIn { $0 }
        }
        #expect(!session.isSignedIn)
        #expect(store.token == nil)
    }

    @Test func remembersTheTokenAndSignsRequestsWithIt() async throws {
        StubProtocol.reply = { _ in (200, #"{"me":\#(me)}"#) }
        let session = makeSession(store: MemoryTokenStore("tok_saved"))
        #expect(session.isSignedIn)
        await session.refresh()
        #expect(session.me?.name == "Alex Rider")
        let request = try #require(StubProtocol.requests.last?.request)
        #expect(request.value(forHTTPHeaderField: "Authorization") == "Bearer tok_saved")
    }

    @Test func signsOutWhenTheServerForgotTheSession() async {
        StubProtocol.reply = { _ in (200, #"{"me":null}"#) }
        let saved = MemoryTokenStore("tok_old")
        let session = makeSession(store: saved)
        await session.refresh()
        #expect(!session.isSignedIn)
        #expect(saved.token == nil)
    }

    @Test func staysSignedInWhileOffline() async {
        StubProtocol.reply = { _ in (503, "{}") }
        let session = makeSession(store: MemoryTokenStore("tok_saved"))
        await session.refresh()
        #expect(session.isSignedIn)
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
        StubProtocol.reply = { _ in (200, #"{"ok":true}"#) }
        let saved = MemoryTokenStore("tok_saved")
        let session = makeSession(store: saved)
        await session.signOut()
        #expect(!session.isSignedIn)
        #expect(saved.token == nil)
        let request = try #require(StubProtocol.requests.last?.request)
        #expect(request.url?.path == "/api/auth/logout")
        #expect(request.value(forHTTPHeaderField: "Authorization") == "Bearer tok_saved")
        #expect(request.value(forHTTPHeaderField: "Content-Type") == "application/json")
    }
}
