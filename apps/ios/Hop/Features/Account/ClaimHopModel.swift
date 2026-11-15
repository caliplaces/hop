import Foundation
import Observation

/// Claiming a handle: checks availability as they type and claims it.
@Observable
final class ClaimHopModel {
    enum Status: Equatable {
        /// Nothing typed yet.
        case idle
        case checking
        case available
        case unavailable(String)
    }

    var input: String {
        didSet { if oldValue != input { scheduleCheck() } }
    }

    var color: PaletteColor
    private(set) var status = Status.idle
    private(set) var isClaiming = false
    /// Why the last claim failed, when it wasn't the handle's fault.
    private(set) var problem: String?

    var handle: String { HandleRules.normalize(input) }
    var canClaim: Bool { status == .available && !isClaiming }

    private let api: APIClient
    private let debounce: Duration
    private var check: Task<Void, Never>?

    init(me: Me, api: APIClient, debounce: Duration = .milliseconds(350)) {
        self.api = api
        self.debounce = debounce
        input = HandleRules.suggestion(name: me.name, email: me.email)
        color = me.paletteColor
        scheduleCheck()
    }

    /// Same words as the website.
    enum Reason {
        static let invalid = String(localized: "2–30 characters: letters, numbers, dots and underscores.")
        static let reserved = String(localized: "That one is reserved.")
        static let taken = String(localized: "That handle is taken.")
        static let offline = String(localized: "Couldn’t check that. Are you online?")
    }

    /// Checks the handle a moment after they stop typing, dropping older checks.
    private func scheduleCheck() {
        check?.cancel()
        problem = nil
        let handle = handle
        guard !handle.isEmpty else {
            status = .idle
            return
        }
        guard HandleRules.isValid(handle) else {
            status = .unavailable(Reason.invalid)
            return
        }
        status = .checking
        check = Task { [api, debounce] in
            try? await Task.sleep(for: debounce)
            guard !Task.isCancelled else { return }
            let result: Status
            do {
                let reply: Availability = try await api.get("api/handles/\(handle)")
                result = reply.available ? .available : .unavailable(Self.reason(reply.problem))
            } catch {
                result = .unavailable(Reason.offline)
            }
            guard !Task.isCancelled, handle == self.handle else { return }
            status = result
        }
    }

    /// Claims the handle in their colour. Returns the updated profile.
    func claim() async -> Me? {
        guard canClaim else { return nil }
        isClaiming = true
        problem = nil
        defer { isClaiming = false }
        do {
            let reply: Claimed = try await api.put(
                "api/me/handle",
                body: ClaimRequest(handle: handle, color: color.id)
            )
            return reply.me
        } catch let error as APIError where error.code == "handle_taken" {
            status = .unavailable(Reason.taken)
        } catch let error as APIError where error.code.hasPrefix("handle_") {
            status = .unavailable(error.message ?? Reason.invalid)
        } catch {
            problem = error.localizedDescription
        }
        return nil
    }

    private static func reason(_ problem: String?) -> String {
        switch problem {
        case "reserved": Reason.reserved
        case "invalid": Reason.invalid
        default: Reason.taken
        }
    }

    private struct Availability: Decodable {
        let available: Bool
        let problem: String?
    }

    private struct ClaimRequest: Encodable {
        let handle: String
        let color: String
    }

    private struct Claimed: Decodable {
        let me: Me
    }
}
