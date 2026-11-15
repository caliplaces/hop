import Foundation

/// An event's inbox ("hop"), as `GET /api/me/hops` describes it. Every
/// athlete has one from the start, named "Inbox"; events add more.
nonisolated struct Hop: Decodable, Identifiable, Hashable, Sendable {
    let id: String
    let slug: String
    let title: String
    /// "open" while it takes uploads, "closed" after.
    let status: String
    /// Milliseconds since 1970, as the API sends times.
    let createdAt: Double
    var fileCount: Int
    var totalBytes: Int64

    var isClosed: Bool { status == "closed" }

    /// "12 clips"
    var clipCount: String {
        fileCount == 1 ? String(localized: "1 clip") : String(localized: "\(fileCount) clips")
    }

    /// "12 clips · 1.2 GB"
    var summary: String {
        guard totalBytes > 0 else { return clipCount }
        return "\(clipCount) · \(ByteCountFormatter.string(fromByteCount: totalBytes, countStyle: .file))"
    }
}

/// One clip someone sent, as `GET /api/me/files` describes it.
nonisolated struct Clip: Decodable, Identifiable, Hashable, Sendable {
    let id: String
    let hopId: String
    let name: String
    let mime: String
    let size: Int64
    let hasThumbnail: Bool
    /// "@handle" for signed-in contributors, otherwise whatever they typed
    /// or a random name like "SmokyMonkey441".
    let contributorName: String?
    let contributorVerified: Bool
    let note: String?
    let createdAt: Double

    var isVideo: Bool { mime.hasPrefix("video/") }

    var sentAt: Date { Date(timeIntervalSince1970: createdAt / 1000) }

    var contributor: String {
        contributorName ?? String(localized: "Someone")
    }
}

nonisolated struct ClipPage: Decodable, Sendable {
    let files: [Clip]
    let nextCursor: String?
}
