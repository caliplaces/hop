import Foundation
import Observation
import UIKit

/// Changes to what others see of an athlete: their name and photo. Edits
/// stay here until saved. They're stored only in Hop, never in the
/// Caliplaces account they signed in with.
@Observable
final class ProfileEditor {
    enum PhotoChange: Equatable {
        case unchanged
        case new(ProfilePhoto.Prepared)
        case removed
    }

    var name: String
    private(set) var photo = PhotoChange.unchanged {
        didSet {
            guard photo != oldValue else { return }
            if case let .new(prepared) = photo {
                pickedImage = UIImage(data: prepared.jpeg)
            } else {
                pickedImage = nil
            }
        }
    }
    /// The new photo, ready to show, while it's unsaved.
    private(set) var pickedImage: UIImage?
    private(set) var isPreparingPhoto = false
    private(set) var isSaving = false
    /// Why the last photo or save failed.
    var problem: String?
    /// The profile as the server last returned it.
    private(set) var me: Me

    /// The most a name can be, as the API counts it (UTF-16 code units).
    static let maxNameLength = 50

    private let api: APIClient
    /// Told about every profile the server returns, even from a save that
    /// went on to fail, so the rest of the app is never behind.
    private let published: (Me) -> Void
    /// Bumped by each photo pick, so an older, slower pick can't win.
    private var photoGeneration = 0

    init(me: Me, api: APIClient, published: @escaping (Me) -> Void = { _ in }) {
        self.me = me
        self.api = api
        self.published = published
        name = me.name ?? ""
    }

    /// The name as it will be saved: like the API, NFC with single spaces.
    var normalizedName: String {
        name.precomposedStringWithCanonicalMapping
            .split(whereSeparator: \.isWhitespace)
            .joined(separator: " ")
    }

    /// What's wrong with the name, for the rules the app can tell; the API
    /// has the last word, and its reason shows if it refuses one.
    var nameProblem: String? {
        let name = normalizedName
        if name.isEmpty { return String(localized: "Enter a name.") }
        if name.utf16.count > Self.maxNameLength { return String(localized: "That name is too long.") }
        if name.hasPrefix("@") { return String(localized: "A name can’t start with @.") }
        return nil
    }

    var nameChanged: Bool { normalizedName != (me.name ?? "") }
    var hasChanges: Bool { nameChanged || photo != .unchanged }
    var canSave: Bool { !isSaving && !isPreparingPhoto && nameProblem == nil }

    /// The photo as it would look saved.
    var shownPhoto: Avatar.Photo {
        if let pickedImage { return .local(pickedImage) }
        if photo == .removed { return .none }
        return me.avatarURL.map(Avatar.Photo.remote) ?? .none
    }

    /// The initial as it would look saved, following the name as it's typed.
    var shownInitial: String {
        normalizedName.first.map { String($0).uppercased() } ?? me.initial
    }

    /// Whether a photo shows: a new one, or the saved one unless removed.
    var hasPhoto: Bool {
        switch photo {
        case .new: true
        case .removed: false
        case .unchanged: me.avatarUrl != nil
        }
    }

    /// Prepares a picked photo. `load` reads its bytes; nil means the picker
    /// had nothing to give.
    func choosePhoto(_ load: () async throws -> Data?) async {
        photoGeneration += 1
        let generation = photoGeneration
        isPreparingPhoto = true
        problem = nil
        defer { if generation == photoGeneration { isPreparingPhoto = false } }
        do {
            guard let data = try await load() else { throw ProfilePhoto.Failure.unreadable }
            let prepared = try await ProfilePhoto.prepare(data)
            guard generation == photoGeneration else { return }
            photo = .new(prepared)
        } catch {
            guard generation == photoGeneration else { return }
            problem = ProfilePhoto.Failure.unreadable.localizedDescription
        }
    }

    func removePhoto() {
        photoGeneration += 1
        isPreparingPhoto = false
        photo = me.avatarUrl == nil ? .unchanged : .removed
    }

    /// Saves what changed, and with `confirming`, that they've seen their
    /// profile. Returns whether everything was saved.
    @discardableResult
    func save(confirming: Bool = false) async -> Bool {
        guard canSave else { return false }
        isSaving = true
        problem = nil
        defer { isSaving = false }
        do {
            switch photo {
            case let .new(prepared):
                let reply: Reply = try await api.put("api/me/avatar", data: prepared.jpeg, contentType: "image/jpeg")
                accept(reply.me)
                photo = .unchanged
            case .removed:
                let reply: Reply = try await api.delete("api/me/avatar")
                accept(reply.me)
                photo = .unchanged
            case .unchanged:
                break
            }
            let changes = Changes(
                displayName: nameChanged ? normalizedName : nil,
                profileReviewed: confirming && !me.profileReviewed ? true : nil
            )
            if !changes.isEmpty {
                let reply: Reply = try await api.patch("api/me", body: changes)
                accept(reply.me)
            }
            return true
        } catch {
            problem = error.localizedDescription
            return false
        }
    }

    /// Takes a newer copy of the profile: a reply to one of this editor's
    /// saves, or a change made elsewhere in the app (another editor, or
    /// buying Hop+). A name they haven't touched follows it, so a stale one
    /// is never sent back over a newer one; a name they're editing, and a
    /// photo they've picked, are kept.
    func sync(with newer: Me) {
        guard newer != me else { return }
        if normalizedName == (me.name ?? "") { name = newer.name ?? "" }
        if photo == .removed, newer.avatarUrl == nil { photo = .unchanged }
        me = newer
    }

    private func accept(_ me: Me) {
        sync(with: me)
        published(me)
    }

    /// Only what changed. Nil fields are left out, not sent as null: a null
    /// name would mean "go back to the Caliplaces one".
    private struct Changes: Encodable {
        let displayName: String?
        let profileReviewed: Bool?

        var isEmpty: Bool { displayName == nil && profileReviewed == nil }
    }

    private struct Reply: Decodable {
        let me: Me
    }
}
