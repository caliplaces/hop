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

    /// The custom scheme Caliplaces used to redirect to after sign-in, before
    /// the https callback. It matches the bundle id.
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

    func get<Response: Decodable>(_ path: String, query: [URLQueryItem] = []) async throws -> Response {
        try await decode(send("GET", path, query: query, body: nil))
    }

    /// The raw bytes of a GET, such as an image.
    func data(_ path: String) async throws -> Data {
        try await send("GET", path, body: nil)
    }

    /// Resolves a URL the API returned, which may be relative to the API
    /// (local development serves files through the API itself).
    func resolve(_ reference: String) -> URL? {
        URL(string: reference, relativeTo: baseURL)?.absoluteURL
    }

    func post<Response: Decodable>(_ path: String, body: some Encodable) async throws -> Response {
        try await decode(send("POST", path, body: JSONEncoder().encode(body)))
    }

    /// A POST whose reply doesn't matter beyond succeeding.
    func post(_ path: String) async throws {
        _ = try await send("POST", path, body: nil)
    }

    func put<Response: Decodable>(_ path: String, body: some Encodable) async throws -> Response {
        try await decode(send("PUT", path, body: JSONEncoder().encode(body)))
    }

    func patch<Response: Decodable>(_ path: String, body: some Encodable) async throws -> Response {
        try await decode(send("PATCH", path, body: JSONEncoder().encode(body)))
    }

    func delete(_ path: String) async throws {
        _ = try await send("DELETE", path, body: nil)
    }

    /// A DELETE whose reply matters, such as the profile it leaves behind.
    func delete<Response: Decodable>(_ path: String) async throws -> Response {
        try await decode(send("DELETE", path, body: nil))
    }

    /// Uploads raw bytes, such as a JPEG, labelled with their own type.
    func put<Response: Decodable>(_ path: String, data: Data, contentType: String) async throws -> Response {
        try await decode(send("PUT", path, body: data, contentType: contentType))
    }

    private func send(
        _ method: String,
        _ path: String,
        query: [URLQueryItem] = [],
        body: Data?,
        contentType: String = "application/json"
    ) async throws -> Data {
        var url = baseURL.appending(path: path)
        if !query.isEmpty { url.append(queryItems: query) }
        var request = URLRequest(url: url)
        request.httpMethod = method
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if method != "GET" {
            // The API treats unlabelled writes like cross-site form posts and
            // refuses them, so every write says what it is: JSON, even
            // without a body, unless it's raw bytes like a photo.
            request.setValue(contentType, forHTTPHeaderField: "Content-Type")
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
    /// The name others see: the one they set in Hop, or else their
    /// Caliplaces account's.
    let name: String?
    let email: String?
    /// Their onmyhop.com/<handle>, once claimed.
    let handle: String?
    let activeHopId: String?
    /// A palette colour id.
    let color: String
    let emailNewClips: Bool
    /// New clips are announced on their phones that allow notifications.
    let pushNewClips: Bool
    /// Their profile photo, relative to the site; without one, their initial shows.
    let avatarUrl: String?
    /// They have Hop+, which their page shows with a Hop+ mark.
    let hopPlus: Bool
    /// They've seen and confirmed what their page shows about them.
    let profileReviewed: Bool

    init(
        id: String,
        name: String?,
        email: String?,
        handle: String?,
        activeHopId: String?,
        color: String,
        emailNewClips: Bool,
        pushNewClips: Bool = true,
        avatarUrl: String? = nil,
        hopPlus: Bool = false,
        profileReviewed: Bool = true
    ) {
        self.id = id
        self.name = name
        self.email = email
        self.handle = handle
        self.activeHopId = activeHopId
        self.color = color
        self.emailNewClips = emailNewClips
        self.pushNewClips = pushNewClips
        self.avatarUrl = avatarUrl
        self.hopPlus = hopPlus
        self.profileReviewed = profileReviewed
    }

    init(from decoder: any Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decode(String.self, forKey: .id)
        name = try container.decodeIfPresent(String.self, forKey: .name)
        email = try container.decodeIfPresent(String.self, forKey: .email)
        handle = try container.decodeIfPresent(String.self, forKey: .handle)
        activeHopId = try container.decodeIfPresent(String.self, forKey: .activeHopId)
        color = try container.decode(String.self, forKey: .color)
        emailNewClips = try container.decode(Bool.self, forKey: .emailNewClips)
        // Servers from before new-clip notifications don't say: they're on.
        pushNewClips = try container.decodeIfPresent(Bool.self, forKey: .pushNewClips) ?? true
        avatarUrl = try container.decodeIfPresent(String.self, forKey: .avatarUrl)
        hopPlus = try container.decodeIfPresent(Bool.self, forKey: .hopPlus) ?? false
        // Servers from before profiles don't say, and couldn't save it, so
        // there's nothing to ask them to confirm.
        profileReviewed = try container.decodeIfPresent(Bool.self, forKey: .profileReviewed) ?? true
    }

    var paletteColor: PaletteColor { Palette.color(id: color) }

    /// Their upload page, on the server this build talks to.
    var link: URL? { handle.map { HopServer.baseURL.appending(path: $0) } }

    /// Their photo, on the server this build talks to. Only ever a path on
    /// Hop's own site, never another one.
    var avatarURL: URL? {
        guard let avatarUrl, avatarUrl.hasPrefix("/"), !avatarUrl.hasPrefix("//") else { return nil }
        return URL(string: avatarUrl, relativeTo: HopServer.baseURL)?.absoluteURL
    }

    /// The first letter of what they're called, for when there's no photo.
    var initial: String {
        let source = name ?? handle ?? email ?? ""
        return source.first.map { String($0).uppercased() } ?? "?"
    }
}
