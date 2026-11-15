import Foundation
import Testing
@testable import Hop

private func hopJSON(_ id: String, title: String = "Jam", files: Int) -> String {
    #"{"id":"\#(id)","slug":"\#(id)","title":"\#(title)","status":"open","createdAt":1700000000000,"fileCount":\#(files),"totalBytes":0}"#
}

private func clipJSON(_ id: String, from name: String, at date: Date) -> String {
    let ms = Int(date.timeIntervalSince1970 * 1000)
    return #"{"id":"\#(id)","hopId":"jam","name":"IMG.MOV","mime":"video/mp4","size":1000,"hasThumbnail":false,"contributorName":"\#(name)","contributorVerified":false,"note":null,"createdAt":\#(ms)}"#
}

private let start = Date(timeIntervalSince1970: 1_800_000_000)

/// Records what Event mode asks of the Live Activity.
@MainActor
final class FakeEventActivity: EventActivityControlling {
    var started: [EventActivityAttributes] = []
    var updates: [EventActivityAttributes.ContentState] = []
    var ends = 0

    func start(_ attributes: EventActivityAttributes) { started.append(attributes) }
    func update(_ state: EventActivityAttributes.ContentState) async { updates.append(state) }
    func end() async { ends += 1 }
}

@MainActor
private func me(id: String = "usr_1") throws -> Me {
    try JSONDecoder().decode(Me.self, from: Data(meJSON().replacingOccurrences(of: "usr_1", with: id).utf8))
}

@MainActor
@Suite("Event mode", .serialized)
struct EventModeTests {
    let server = StubServer(host: "event.test")
    let defaults = UserDefaults(suiteName: "event-tests-\(UUID().uuidString)")!
    let activity = FakeEventActivity()
    /// The clock Event mode reads; tests move it on.
    let clock = Locked(start)

    private func eventMode() -> EventMode {
        let clock = clock
        return EventMode(defaults: defaults, activity: activity, now: { clock.value })
    }

    private func path(_ request: URLRequest) -> String { request.url?.path ?? "" }

    @Test func aNewEventIsCreatedMadeLiveAndShownOnTheLockScreen() async throws {
        server.reply = { request in
            switch (request.httpMethod, request.url?.path) {
            case ("POST", "/api/me/hops"): (201, #"{"hop":\#(hopJSON("jam", title: "Prague Open", files: 0))}"#)
            case ("POST", "/api/me/hops/jam/activate"): (200, #"{"ok":true}"#)
            default: (404, "{}")
            }
        }
        let mode = eventMode()
        try await mode.start(.newEvent(title: "Prague Open"), me: me(), api: server.client(token: "hs_t"))

        #expect(mode.run == EventRun(userId: "usr_1", hopId: "jam", title: "Prague Open", startedAt: start, baseline: 0))
        #expect(mode.clips == 0)
        let create = try #require(server.requests.first { path($0.request) == "/api/me/hops" })
        let body = try JSONSerialization.jsonObject(with: create.body) as? [String: Any]
        #expect(body?["title"] as? String == "Prague Open")
        #expect(body?["slug"] == nil)
        #expect(server.requests.contains { path($0.request) == "/api/me/hops/jam/activate" })
        #expect(activity.started.map(\.title) == ["Prague Open"])
        #expect(activity.started.first?.link.absoluteString.hasSuffix("/alex") == true)
        #expect(activity.started.first?.color == "grape")
    }

    @Test func aTakenEventNameGetsTheNextNumber() async throws {
        let attempts = Locked(0)
        server.reply = { request in
            switch (request.httpMethod, request.url?.path) {
            case ("POST", "/api/me/hops/jam/activate"):
                return (200, #"{"ok":true}"#)
            case ("POST", "/api/me/hops"):
                attempts.value += 1
                return attempts.value == 3
                    ? (201, #"{"hop":\#(hopJSON("jam", title: "Prague Open", files: 0))}"#)
                    : (409, #"{"error":"slug_taken","message":"You already have a Hop with that link."}"#)
            default:
                return (404, "{}")
            }
        }
        let mode = eventMode()
        try await mode.start(.newEvent(title: "Prague Open"), me: me(), api: server.client(token: "hs_t"))

        #expect(mode.run?.hopId == "jam")
        let slugs = try server.requests
            .filter { path($0.request) == "/api/me/hops" }
            .map { try JSONSerialization.jsonObject(with: $0.body) as? [String: Any] }
            .map { $0?["slug"] as? String }
        #expect(slugs == [nil, "Prague Open 2", "Prague Open 3"])
    }

    @Test func clipsCountFromWhenEventModeStartedAndNameWhoSentThem() async throws {
        let fileCount = Locked(12)
        server.reply = { request in
            switch request.url?.path {
            case "/api/me/hops/jam/activate": (200, #"{"ok":true}"#)
            case "/api/me/hops": (200, #"{"hops":[\#(hopJSON("jam", files: fileCount.value))]}"#)
            case "/api/me/files": (200, #"{"files":[\#(clipJSON("c3", from: "@mia", at: start + 30)),\#(clipJSON("c2", from: "SmokyMonkey441", at: start + 20)),\#(clipJSON("c1", from: "Old", at: start - 600))],"nextCursor":null}"#)
            default: (404, "{}")
            }
        }
        let existing = try JSONDecoder().decode(Hop.self, from: Data(hopJSON("jam", files: 12).utf8))
        let mode = eventMode()
        let api = server.client(token: "hs_t")
        try await mode.start(.existing(existing), me: me(), api: api)
        #expect(mode.run?.baseline == 12)
        #expect(!server.requests.contains { $0.request.httpMethod == "POST" && path($0.request) == "/api/me/hops" })

        // Nothing new: no clips, no celebration.
        await mode.poll(api: api)
        #expect(mode.clips == 0)
        #expect(mode.arrival == nil)
        #expect(!server.requests.contains { path($0.request) == "/api/me/files" })

        fileCount.value = 14
        await mode.poll(api: api)
        #expect(mode.clips == 2)
        #expect(mode.latest == "@mia")
        #expect(mode.arrival?.senders == ["@mia", "SmokyMonkey441"])
        #expect(mode.arrival?.headline == "@mia and 1 more")
        #expect(mode.arrival?.announcement == "@mia and 1 other sent clips")
        #expect(activity.updates.last == .init(clips: 2, latest: "@mia"))

        // The same clips aren't celebrated twice.
        let celebrated = mode.arrival?.id
        await mode.poll(api: api)
        #expect(mode.arrival?.id == celebrated)
    }

    @Test func aReplyThatArrivesAfterEndingChangesNothing() async throws {
        server.reply = { request in
            switch request.url?.path {
            case "/api/me/hops/jam/activate": (200, #"{"ok":true}"#)
            case "/api/me/hops": (200, #"{"hops":[\#(hopJSON("jam", files: 3))]}"#)
            default: (404, "{}")
            }
        }
        let existing = try JSONDecoder().decode(Hop.self, from: Data(hopJSON("jam", files: 0).utf8))
        let mode = eventMode()
        let api = server.client(token: "hs_t")
        try await mode.start(.existing(existing), me: me(), api: api)

        server.held = ["/api/me/hops"]
        let polling = Task { await mode.poll(api: api) }
        try await server.waitForRequest("/api/me/hops")
        await mode.end()
        server.release()
        await polling.value

        #expect(mode.run == nil)
        #expect(mode.clips == 0)
        #expect(mode.arrival == nil)
        #expect(activity.updates.isEmpty)
    }

    @Test func endingStopsEverythingButKeepsTheLinkOnTheEvent() async throws {
        server.reply = { request in
            request.url?.path == "/api/me/hops/jam/activate" ? (200, #"{"ok":true}"#) : (404, "{}")
        }
        let existing = try JSONDecoder().decode(Hop.self, from: Data(hopJSON("jam", files: 0).utf8))
        let mode = eventMode()
        try await mode.start(.existing(existing), me: me(), api: server.client(token: "hs_t"))
        mode.isStagePresented = true
        let before = server.requests.count
        let endsBefore = activity.ends

        await mode.end()

        #expect(mode.run == nil)
        #expect(!mode.isStagePresented)
        #expect(activity.ends == endsBefore + 1)
        // Nothing is sent: the link keeps uploading into the event.
        #expect(server.requests.count == before)
        // And it doesn't come back on the next launch.
        let relaunched = eventMode()
        try await relaunched.resume(for: me())
        #expect(relaunched.run == nil)
    }

    @Test func aRunningEventResumesOnlyForItsAthleteAndUntilItRunsOut() async throws {
        server.reply = { request in
            request.url?.path == "/api/me/hops/jam/activate" ? (200, #"{"ok":true}"#) : (404, "{}")
        }
        let existing = try JSONDecoder().decode(Hop.self, from: Data(hopJSON("jam", files: 0).utf8))
        try await eventMode().start(.existing(existing), me: me(), api: server.client(token: "hs_t"))

        // Relaunched, same athlete.
        let relaunched = eventMode()
        try await relaunched.resume(for: me())
        #expect(relaunched.run?.hopId == "jam")

        // Someone else signed in: it's not theirs, and it's gone for good.
        let someoneElse = eventMode()
        let endsBefore = activity.ends
        try await someoneElse.resume(for: me(id: "usr_2"))
        #expect(someoneElse.run == nil)
        #expect(activity.ends == endsBefore + 1)
        let again = eventMode()
        try await again.resume(for: me())
        #expect(again.run == nil)
    }

    @Test func afterARelaunchItCatchesUpWithoutCelebrating() async throws {
        let fileCount = Locked(0)
        server.reply = { request in
            switch request.url?.path {
            case "/api/me/hops/jam/activate": (200, #"{"ok":true}"#)
            case "/api/me/hops": (200, #"{"hops":[\#(hopJSON("jam", files: fileCount.value))]}"#)
            case "/api/me/files": (200, #"{"files":[\#(clipJSON("c2", from: "@mia", at: start + 20)),\#(clipJSON("c1", from: "@leo", at: start + 10))],"nextCursor":null}"#)
            default: (404, "{}")
            }
        }
        let existing = try JSONDecoder().decode(Hop.self, from: Data(hopJSON("jam", files: 0).utf8))
        let api = server.client(token: "hs_t")
        try await eventMode().start(.existing(existing), me: me(), api: api)

        // Two clips land while the app is shut.
        fileCount.value = 2
        let relaunched = eventMode()
        try await relaunched.resume(for: me())
        await relaunched.poll(api: api)
        #expect(relaunched.clips == 2)
        #expect(relaunched.latest == "@mia")
        #expect(relaunched.arrival == nil)
        #expect(activity.updates.last == .init(clips: 2, latest: "@mia"))

        // From then on, new clips are celebrated as usual.
        fileCount.value = 3
        server.reply = { request in
            switch request.url?.path {
            case "/api/me/hops": (200, #"{"hops":[\#(hopJSON("jam", files: 3))]}"#)
            case "/api/me/files": (200, #"{"files":[\#(clipJSON("c3", from: "Mum", at: start + 30)),\#(clipJSON("c2", from: "@mia", at: start + 20))],"nextCursor":null}"#)
            default: (404, "{}")
            }
        }
        await relaunched.poll(api: api)
        #expect(relaunched.clips == 3)
        #expect(relaunched.arrival?.senders == ["Mum"])
    }

    @Test func anEventRunsOutAfterTwelveHours() async throws {
        server.reply = { request in
            request.url?.path == "/api/me/hops/jam/activate" ? (200, #"{"ok":true}"#) : (404, "{}")
        }
        let existing = try JSONDecoder().decode(Hop.self, from: Data(hopJSON("jam", files: 0).utf8))
        try await eventMode().start(.existing(existing), me: me(), api: server.client(token: "hs_t"))

        clock.value = start + EventMode.maxDuration - 60
        let soon = eventMode()
        try await soon.resume(for: me())
        #expect(soon.run != nil)

        clock.value = start + EventMode.maxDuration
        let late = eventMode()
        try await late.resume(for: me())
        #expect(late.run == nil)
    }

    @Test func aDeletedEventEndsEventMode() async throws {
        server.reply = { request in
            switch request.url?.path {
            case "/api/me/hops/jam/activate": (200, #"{"ok":true}"#)
            case "/api/me/hops": (200, #"{"hops":[\#(hopJSON("other", files: 4))]}"#)
            default: (404, "{}")
            }
        }
        let existing = try JSONDecoder().decode(Hop.self, from: Data(hopJSON("jam", files: 0).utf8))
        let mode = eventMode()
        let api = server.client(token: "hs_t")
        try await mode.start(.existing(existing), me: me(), api: api)

        await mode.poll(api: api)
        #expect(mode.run == nil)
    }

    @Test func goingOfflineShowsAndComesBack() async throws {
        let online = Locked(true)
        server.reply = { request in
            switch request.url?.path {
            case "/api/me/hops/jam/activate": (200, #"{"ok":true}"#)
            case "/api/me/hops" where online.value: (200, #"{"hops":[\#(hopJSON("jam", files: 0))]}"#)
            case "/api/me/hops": (503, "{}")
            default: (404, "{}")
            }
        }
        let existing = try JSONDecoder().decode(Hop.self, from: Data(hopJSON("jam", files: 0).utf8))
        let mode = eventMode()
        let api = server.client(token: "hs_t")
        try await mode.start(.existing(existing), me: me(), api: api)

        online.value = false
        await mode.poll(api: api)
        #expect(mode.isOffline)
        #expect(mode.run != nil)

        online.value = true
        await mode.poll(api: api)
        #expect(!mode.isOffline)
    }
}

/// A value the stub's reply closure can read while the test changes it.
final class Locked<Value: Sendable>: @unchecked Sendable {
    private let lock = NSLock()
    private var stored: Value
    init(_ value: Value) { stored = value }
    var value: Value {
        get { lock.withLock { stored } }
        set { lock.withLock { stored = newValue } }
    }
}
