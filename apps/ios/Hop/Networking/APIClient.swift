import Foundation

/// Where Hop's API lives. Debug builds use staging and release builds
/// production. In debug builds, the launch argument `-HopAPIURL <url>` points
/// the app at another server, such as `wrangler dev` on this Mac.
nonisolated enum HopServer {
    static var baseURL: URL {
        #if DEBUG
        if let override = UserDefaults.standard.string(forKey: "HopAPIURL"),
           let url = URL(string: override),
           isAllowedOverride(url) {
            return url
        }
        return URL(string: "https://staging.onmyhop.com")!
        #else
        return URL(string: "https://onmyhop.com")!
        #endif
    }

    /// Overrides must be https, or plain http to this Mac only.
    static func isAllowedOverride(_ url: URL) -> Bool {
        switch url.scheme {
        case "https": url.host() != nil
        case "http": ["127.0.0.1", "localhost"].contains(url.host())
        default: false
        }
    }

    /// Names a server for storing its token: scheme, host and port, so two
    /// local servers on different ports never share a sign-in.
    static func storageKey(for url: URL) -> String {
        let port = url.port.map { ":\($0)" } ?? ""
        return "\(url.scheme ?? "https")://\(url.host() ?? "")\(port)"
    }

    /// The custom scheme Caliplaces redirects to after sign-in. It matches the
    /// bundle id and the redirect URI registered on the app's developer app.
    static let callbackScheme = "com.onmyhop.app"
}

/// A failed request, in the API's own words when it gave any.
nonisolated struct APIError: LocalizedError, Equatable, Sendable {
    let status: Int
    let code: String
    let message: String?

    var errorDescription: String? {
        message ?? String(localized: "Something went wrong. Please try again.")
    }
}

/// A small JSON client for Hop's API. Signs requests with the session's
/// bearer token when there is one.
nonisolated struct APIClient: Sendable {
    var baseURL: URL
    var token: String?
    var session: URLSession = .shared

    func get<Response: Decodable>(_ path: String) async throws -> Response {
        try await decode(send("GET", path, body: nil))
    }

    func post<Response: Decodable>(_ path: String, body: some Encodable) async throws -> Response {
        try await decode(send("POST", path, body: JSONEncoder().encode(body)))
    }

    /// A POST whose reply doesn't matter beyond succeeding.
    func post(_ path: String) async throws {
        _ = try await send("POST", path, body: nil)
    }

    private func send(_ method: String, _ path: String, body: Data?) async throws -> Data {
        var request = URLRequest(url: baseURL.appending(path: path))
        request.httpMethod = method
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if method != "GET" {
            // The API treats unlabelled POSTs like cross-site form posts and
            // refuses them, so every POST says it's JSON, even without a body.
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = body
        }
        if let token {
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }

        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw URLError(.badServerResponse) }
        guard (200..<300).contains(http.statusCode) else {
            let reply = try? JSONDecoder().decode(ErrorReply.self, from: data)
            throw APIError(
                status: http.statusCode,
                code: reply?.error ?? "http_\(http.statusCode)",
                message: reply?.message
            )
        }
        return data
    }

    private func decode<Response: Decodable>(_ data: Data) throws -> Response {
        try JSONDecoder().decode(Response.self, from: data)
    }

    private struct ErrorReply: Decodable {
        let error: String
        let message: String?
    }
}

/// The signed-in athlete, as `GET /api/me` describes them.
nonisolated struct Me: Codable, Equatable, Sendable {
    let id: String
    let name: String?
    let email: String?
    /// Their onmyhop.com/<handle>, once claimed.
    let handle: String?
    let activeHopId: String?
    /// A palette colour id.
    let color: String
    let emailNewClips: Bool
}
