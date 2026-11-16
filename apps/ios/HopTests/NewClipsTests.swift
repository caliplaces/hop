import Foundation
import Testing
import UserNotifications
@testable import Hop

/// Stands in for the system's notification center: notifications allowed.
private final class AllowingCenter: NotificationCenterProtocol, @unchecked Sendable {
    func authorizationStatus() async -> UNAuthorizationStatus { .authorized }
    func requestAuthorization(options: UNAuthorizationOptions) async throws -> Bool { true }
}

private func meJSON(push: Bool, email: Bool = true) -> String {
    """
    {"me":{"id":"usr_1","name":"Alex","email":"alex@example.com","handle":"alex",
     "activeHopId":"hop_1","color":"grape","emailNewClips":\(email),"pushNewClips":\(push)}}
    """
}

@MainActor
@Suite("Notifications of new clips", .serialized)
struct NewClipsTests {
    let server = StubServer(host: "newclips-\(UUID().uuidString.lowercased()).test")

    private func me(push: Bool = true, email: Bool = true) -> Me {
        Me(id: "usr_1", name: "Alex", email: "alex@example.com", handle: "alex",
           activeHopId: "hop_1", color: "grape", emailNewClips: email, pushNewClips: push)
    }

    @Test func readsWhatANotificationIsAbout() {
        typealias Opened = PushNotifications.Opened
        #expect(Opened(userInfo: ["hop": "clips", "hopId": "hop_1"]) == .clips(hopId: "hop_1"))
        #expect(Opened(userInfo: ["hop": "clips"]) == .clips(hopId: nil))
        #expect(Opened(userInfo: ["hop": "expiring"]) == .expiring)
        #expect(Opened(userInfo: ["aps": ["alert": "Hi"]]) == nil)
        #expect(Opened(userInfo: ["hop": 3]) == nil)
    }

    @Test func keepsATapForTheInboxAndCountsArrivals() {
        let defaults = UserDefaults(suiteName: "NewClipsTests.\(UUID().uuidString)")!
        let push = PushNotifications(defaults: defaults, center: AllowingCenter()) {}
        push.tapped(.clips(hopId: "hop_1"))
        #expect(push.opened == .clips(hopId: "hop_1"))
        push.tapped(nil)
        #expect(push.opened == .clips(hopId: "hop_1"))

        // Only new clips reload the inbox.
        push.arrived(.expiring)
        push.arrived(nil)
        #expect(push.arrivals == 0)
        push.arrived(.clips(hopId: nil))
        #expect(push.arrivals == 1)
    }

    @Test func readsTheSettingAndAssumesItOnFromOlderServers() throws {
        let off = try JSONDecoder().decode(Me.self, from: Data("""
            {"id":"u","name":null,"email":null,"handle":null,"activeHopId":null,"color":"grape",
             "emailNewClips":true,"pushNewClips":false}
            """.utf8))
        #expect(!off.pushNewClips)
        let older = try JSONDecoder().decode(Me.self, from: Data("""
            {"id":"u","name":null,"email":null,"handle":null,"activeHopId":null,"color":"grape",
             "emailNewClips":true}
            """.utf8))
        #expect(older.pushNewClips)
    }

    @Test func savesOnlyTheSwitchFlipped() async throws {
        server.reply = { _ in (200, meJSON(push: false)) }
        let settings = NewClipsSettings(me: me())
        var published: [Me] = []
        await settings.setPush(false, api: server.client(token: "hs_test")) { published.append($0) }

        let request = try #require(server.requests.last)
        #expect(request.request.httpMethod == "PATCH")
        #expect(request.request.url?.path == "/api/me")
        let body = try #require(try JSONSerialization.jsonObject(with: request.body) as? [String: Bool])
        #expect(body == ["pushNewClips": false])
        #expect(!settings.push)
        #expect(settings.email)
        #expect(published.map(\.pushNewClips) == [false])
        #expect(settings.problem == nil)
    }

    @Test func flipsBackWhenSavingFails() async {
        server.reply = { _ in (429, #"{"error":"rate_limited","message":"Too many changes. Try again in a minute."}"#) }
        let settings = NewClipsSettings(me: me())
        var published: [Me] = []
        await settings.setEmail(false, api: server.client()) { published.append($0) }
        #expect(settings.email)
        #expect(settings.problem == "Too many changes. Try again in a minute.")
        #expect(published.isEmpty)
    }

    @Test func aFlipDuringASaveGoesNextSoTheServerEndsWithTheLast() async throws {
        // The server answers with each change as it applies it.
        let calls = Locked(0)
        server.reply = { _ in
            calls.value += 1
            return (200, meJSON(push: calls.value == 1 ? false : true))
        }
        let settings = NewClipsSettings(me: me())
        var published: [Me] = []

        // Off, held on its way; then back on, while it is.
        server.held = ["/api/me"]
        let off = Task { await settings.setPush(false, api: server.client()) { published.append($0) } }
        try await server.waitForRequest("/api/me")
        server.held = []
        await settings.setPush(true, api: server.client()) { published.append($0) }
        #expect(settings.push)
        #expect(server.requests.count == 1)

        server.release()
        await off.value
        let bodies = try server.requests.map {
            try #require(try JSONSerialization.jsonObject(with: $0.body) as? [String: Bool])
        }
        #expect(bodies == [["pushNewClips": false], ["pushNewClips": true]])
        #expect(settings.push)
        #expect(published.map(\.pushNewClips) == [false, true])
    }

    @Test func showsAChangeMadeElsewhereToTheOtherSwitch() async throws {
        // Email was turned off on the web meanwhile.
        server.reply = { _ in (200, meJSON(push: false, email: false)) }
        let settings = NewClipsSettings(me: me())
        await settings.setPush(false, api: server.client()) { _ in }
        #expect(!settings.push)
        #expect(!settings.email)
        // Nothing sent back over it.
        #expect(server.requests.count == 1)
    }

    @Test func aFailedSaveKeepsAFlipMadeMeanwhile() async throws {
        let calls = Locked(0)
        server.reply = { _ in
            calls.value += 1
            return calls.value == 1
                ? (500, #"{"error":"internal","message":"Something broke."}"#)
                : (200, meJSON(push: true, email: false))
        }
        let settings = NewClipsSettings(me: me())

        // Notifications off, held (it'll fail); Email off meanwhile.
        server.held = ["/api/me"]
        let off = Task { await settings.setPush(false, api: server.client()) { _ in } }
        try await server.waitForRequest("/api/me")
        server.held = []
        await settings.setEmail(false, api: server.client()) { _ in }

        server.release()
        await off.value
        let bodies = try server.requests.map {
            try #require(try JSONSerialization.jsonObject(with: $0.body) as? [String: Bool])
        }
        #expect(bodies == [["pushNewClips": false], ["emailNewClips": false]])
        #expect(settings.push)
        #expect(!settings.email)
        #expect(settings.problem == "Something broke.")
    }

    @Test func takesAChangeSavedElsewhereUnlessSaving() async throws {
        let settings = NewClipsSettings(me: me())
        settings.sync(with: me(push: true, email: false))
        #expect(!settings.email)

        server.reply = { _ in (200, meJSON(push: false, email: false)) }
        server.held = ["/api/me"]
        let off = Task { await settings.setPush(false, api: server.client()) { _ in } }
        try await server.waitForRequest("/api/me")
        // An older copy arriving mid-save doesn't undo the flip.
        settings.sync(with: me(push: true, email: true))
        #expect(!settings.push)
        server.release()
        await off.value
        #expect(!settings.push)
        #expect(!settings.email)
    }
}
