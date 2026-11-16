import Foundation
import Observation

/// Why something is reported, as the API names it.
nonisolated enum ReportReason: String, CaseIterable, Identifiable, Encodable, Sendable {
    case sexual, violence, harassment, spam, other

    var id: String { rawValue }

    var title: String {
        switch self {
        case .sexual: String(localized: "Sexual content")
        case .violence: String(localized: "Violence or threats")
        case .harassment: String(localized: "Harassment or hate")
        case .spam: String(localized: "Spam or scam")
        case .other: String(localized: "Something else")
        }
    }
}

/// Reporting clips to Hop's team, and blocking whoever sent them. Anyone
/// with an athlete's link can send them clips, so both are always at hand
/// (App Store Guideline 1.2). See "Reports and blocks" in apps/api/README.md.
nonisolated enum Moderation {
    /// The longest note the API takes with a report, as it counts: in
    /// UTF-16 units (JavaScript's length), so an emoji can count as two.
    static let maxNoteLength = 500

    /// `text` cut to `maxNoteLength` as the API counts, never through the
    /// middle of a character.
    static func limited(_ text: String) -> String {
        guard text.utf16.count > maxNoteLength else { return text }
        var kept = ""
        var units = 0
        for character in text {
            let size = character.utf16.count
            guard units + size <= maxNoteLength else { break }
            kept.append(character)
            units += size
        }
        return kept
    }

    /// The note as it's sent: trimmed and limited, or none if empty.
    static func noteForAPI(_ note: String) -> String? {
        let trimmed = note.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : limited(trimmed)
    }

    /// Sends a report of `clip` to Hop's team.
    static func report(_ clip: Clip, reason: ReportReason, note: String, api: APIClient) async throws {
        let _: Done = try await api.post(
            "api/me/files/\(clip.id)/report",
            body: ReportBody(reason: reason, note: noteForAPI(note))
        )
    }

    /// Stops whoever sent `clip` from sending more. Their clips leave the
    /// inbox: returns which, so the app can drop them at once.
    @discardableResult
    static func block(_ clip: Clip, api: APIClient) async throws -> Set<String> {
        let reply: BlockReply = try await api.post("api/me/files/\(clip.id)/block", body: Empty())
        return Set(reply.removedIds ?? [])
    }

    private struct Empty: Encodable {}

    private struct BlockReply: Decodable {
        let removedIds: [String]?
    }

    private struct ReportBody: Encodable {
        let reason: ReportReason
        let note: String?
    }

    private struct Done: Decodable {}
}

/// Someone the athlete blocked, as `GET /api/me/blocks` lists them.
nonisolated struct BlockedSender: Decodable, Identifiable, Equatable, Sendable {
    let id: String
    /// How they appeared on the clip that was blocked.
    let label: String?
    /// Milliseconds since 1970, as the API sends times.
    let createdAt: Double

    var name: String { label ?? String(localized: "Someone") }
    var blockedAt: Date { Date(timeIntervalSince1970: createdAt / 1000) }
}

/// The athlete's blocked senders, for Account → Blocked Senders.
@Observable
final class BlockedSenders {
    private(set) var senders: [BlockedSender]?
    private(set) var loadError: String?
    /// Why the last unblock failed.
    var problem: String?

    private let api: APIClient

    init(api: APIClient) {
        self.api = api
    }

    func load() async {
        do {
            let reply: Reply = try await api.get("api/me/blocks")
            senders = reply.blocks
            loadError = nil
        } catch {
            if senders == nil { loadError = error.localizedDescription }
        }
    }

    /// Lets them send clips again. Gone from the list at once, and back if
    /// the server says no.
    func unblock(_ sender: BlockedSender) async {
        guard let index = senders?.firstIndex(of: sender) else { return }
        senders?.remove(at: index)
        do {
            try await api.delete("api/me/blocks/\(sender.id)")
        } catch let error as APIError where error.status == 404 {
            // Already unblocked, elsewhere.
        } catch {
            var restored = senders ?? []
            restored.insert(sender, at: min(index, restored.count))
            senders = restored
            problem = error.localizedDescription
        }
    }

    private struct Reply: Decodable {
        let blocks: [BlockedSender]
    }
}
