import Foundation
@testable import Hop

/// Answers requests from closures instead of the network, and records them.
/// State is kept per host, so each suite gets its own fake server through
/// `StubServer` and suites can run in parallel.
final class StubProtocol: URLProtocol {
    typealias Reply = @Sendable (URLRequest) -> (Int, String)
    static let notFound: Reply = { _ in (404, "{}") }

    fileprivate struct Host {
        var reply: Reply = StubProtocol.notFound
        var requests: [(request: URLRequest, body: Data)] = []
        /// Paths whose replies wait for `release()`, to stage races.
        var held: Set<String> = []
        var pending: [StubProtocol] = []
    }

    fileprivate static let lock = NSLock()
    nonisolated(unsafe) fileprivate static var hosts: [String: Host] = [:]

    /// The thread URLSession started this request on; held replies go back there.
    fileprivate var loadingThread: Thread?

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
        let host = request.url?.host() ?? ""
        let path = request.url?.path ?? ""
        let hold = Self.lock.withLock {
            Self.hosts[host, default: Host()].requests.append((request, body))
            guard Self.hosts[host]?.held.contains(path) == true else { return false }
            Self.hosts[host]?.pending.append(self)
            return true
        }
        if hold {
            loadingThread = .current
        } else {
            deliver()
        }
    }

    @objc fileprivate func deliver() {
        let host = request.url?.host() ?? ""
        let reply: Reply? = Self.lock.withLock { Self.hosts[host]?.reply }
        let (status, json) = (reply ?? Self.notFound)(request)
        let response = HTTPURLResponse(
            url: request.url!, statusCode: status, httpVersion: nil,
            headerFields: ["Content-Type": "application/json"]
        )!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        // "base64:…" replies carry binary bodies, such as images.
        let body = json.hasPrefix("base64:")
            ? Data(base64Encoded: String(json.dropFirst(7))) ?? Data()
            : Data(json.utf8)
        client?.urlProtocol(self, didLoad: body)
        client?.urlProtocolDidFinishLoading(self)
    }

    override func stopLoading() {}
}

/// A fake Hop API on its own host. Give each suite a different host.
struct StubServer: Sendable {
    let host: String

    init(host: String) {
        self.host = host
        StubProtocol.lock.withLock { StubProtocol.hosts[host] = StubProtocol.Host() }
    }

    var baseURL: URL { URL(string: "https://\(host)")! }

    var reply: StubProtocol.Reply {
        get {
            let reply: StubProtocol.Reply? = StubProtocol.lock.withLock { StubProtocol.hosts[host]?.reply }
            return reply ?? StubProtocol.notFound
        }
        nonmutating set { StubProtocol.lock.withLock { StubProtocol.hosts[host, default: .init()].reply = newValue } }
    }

    var requests: [(request: URLRequest, body: Data)] {
        StubProtocol.lock.withLock { StubProtocol.hosts[host]?.requests ?? [] }
    }

    var held: Set<String> {
        get { StubProtocol.lock.withLock { StubProtocol.hosts[host]?.held ?? [] } }
        nonmutating set { StubProtocol.lock.withLock { StubProtocol.hosts[host, default: .init()].held = newValue } }
    }

    /// Lets held replies through: all of them, or those matching `matching`.
    func release(where matching: @escaping (URLRequest) -> Bool = { _ in true }) {
        let waiting = StubProtocol.lock.withLock {
            let pending = StubProtocol.hosts[host]?.pending ?? []
            StubProtocol.hosts[host]?.pending = pending.filter { !matching($0.request) }
            return pending.filter { matching($0.request) }
        }
        for stub in waiting {
            stub.perform(#selector(StubProtocol.deliver), on: stub.loadingThread!, with: nil, waitUntilDone: false)
        }
    }

    /// Waits until `count` requests matching `matching` have reached the stub.
    func waitForRequests(count: Int = 1, where matching: (URLRequest) -> Bool) async throws {
        for _ in 0..<400 {
            if requests.filter({ matching($0.request) }).count >= count { return }
            try await Task.sleep(for: .milliseconds(5))
        }
        throw URLError(.timedOut)
    }

    /// A URL session whose requests all go to stubs.
    func urlSession() -> URLSession {
        URLSession(configuration: configuration())
    }

    func configuration() -> URLSessionConfiguration {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [StubProtocol.self]
        return configuration
    }

    func client(token: String? = nil) -> APIClient {
        APIClient(baseURL: baseURL, token: token, session: urlSession())
    }

    /// Waits until a request for `path` has reached the stub.
    func waitForRequest(_ path: String) async throws {
        for _ in 0..<400 {
            if requests.contains(where: { $0.request.url?.path == path }) { return }
            try await Task.sleep(for: .milliseconds(5))
        }
        throw URLError(.timedOut)
    }
}

final class MemoryTokenStore: TokenStore, @unchecked Sendable {
    var token: String?
    init(_ token: String? = nil) { self.token = token }
    func read() -> String? { token }
    func write(_ token: String) throws { self.token = token }
    func delete() { token = nil }
    func deleteAll() { token = nil }
}

/// A signed-in athlete's profile, as the API sends it.
func meJSON(handle: String? = "alex", color: String = "grape") -> String {
    let handleJSON = handle.map { "\"\($0)\"" } ?? "null"
    return """
        {"id":"usr_1","name":"Alex Rider","email":"alex@example.com","handle":\(handleJSON),
         "activeHopId":"hop_1","color":"\(color)","emailNewClips":true}
        """
}
