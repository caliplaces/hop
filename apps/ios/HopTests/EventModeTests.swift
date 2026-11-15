import Foundation
import Testing
@testable import Hop

private func hopJSON(_ id: String, slug: String? = nil, title: String = "Jam", files: Int = 0) -> String {
    #"{"id":"\#(id)","slug":"\#(slug ?? id)","title":"\#(title)","status":"open","createdAt":1700000000000,"fileCount":\#(files),"totalBytes":0}"#
}

private func clipJSON(_ id: String, from name: String) -> String {
    #"{"id":"\#(id)","hopId":"jam","name":"IMG.MOV","mime":"video/mp4","size":1000,"hasThumbnail":false,"contributorName":"\#(name)","contributorVerified":false,"note":null,"createdAt":1700000000000}"#
}

/// The arrivals reply: how many, and the newest clips as `(id, sender)`.
private func arrivalsJSON(_ count: Int, _ latest: [(String, String)]) -> String {
    #"{"count":\#(count),"latest":[\#(latest.map { clipJSON($0.0, from: $0.1) }.joined(separator: ","))]}"#
}

/// When the server says Event mode started, in milliseconds.
private let activatedAt = 1_800_000_000_123
private let activated = #"{"ok":true,"activatedAt":\#(activatedAt)}"#
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

    /// Each follower of the push tokens, newest last.
    private var followers: [AsyncStream<String>.Continuation] = []
    func pushTokens() -> AsyncStream<String> {
        let (stream, continuation) = AsyncStream.makeStream(of: String.self)
        followers.append(continuation)
        return stream
    }
    /// Apple issues (or rotates to) a push token.
    func issue(_ token: String) { followers.last?.yield(token) }
}

@MainActor
private func me(id: String = "usr_1") throws -> Me {
    try JSONDecoder().decode(Me.self, from: Data(meJSON().replacingOccurrences(of: "usr_1", with: id).utf8))
}

private func jam(files: Int = 0) throws -> Hop {
    try JSONDecoder().decode(Hop.self, from: Data(hopJSON("jam", files: files).utf8))
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

    private func body(_ entry: (request: URLRequest, body: Data)) -> [String: Any]? {
        try? JSONSerialization.jsonObject(with: entry.body) as? [String: Any]
    }

    /// Answers activation, and arrivals with whatever `arrivals` holds.
    private func serve(arrivals: Locked<String>) {
        server.reply = { request in
            switch request.url?.path {
            case "/api/me/hops/jam/activate": (200, activated)
            case "/api/me/hops/jam/arrivals": (200, arrivals.value)
            default: (404, "{}")
            }
        }
    }

    @Test func aNewEventIsCreatedMadeLiveAndShownOnTheLockScreen() async throws {
        server.reply = { request in
            switch (request.httpMethod, request.url?.path) {
            case ("GET", "/api/me/hops"): (200, #"{"hops":[\#(hopJSON("inbox", title: "Main"))]}"#)
            case ("POST", "/api/me/hops"): (201, #"{"hop":\#(hopJSON("jam", slug: "prague-open", title: "Prague Open"))}"#)
            case ("POST", "/api/me/hops/jam/activate"): (200, activated)
            default: (404, "{}")
            }
        }
        let mode = eventMode()
        try await mode.start(.newEvent(title: "Prague Open"), me: me(), api: server.client(token: "hs_t"))

        #expect(mode.run == EventRun(
            userId: "usr_1", hopId: "jam", title: "Prague Open", startedAt: start, since: Double(activatedAt)
        ))
        #expect(mode.clips == 0)
        let create = try #require(server.requests.first { $0.request.httpMethod == "POST" && path($0.request) == "/api/me/hops" })
        #expect(body(create)?["title"] as? String == "Prague Open")
        #expect(body(create)?["slug"] as? String == "prague-open")
        #expect(server.requests.contains { path($0.request) == "/api/me/hops/jam/activate" })
        #expect(activity.started.map(\.title) == ["Prague Open"])
        #expect(activity.started.first?.link.absoluteString.hasSuffix("/alex") == true)
        #expect(activity.started.first?.color == "grape")
    }

    @Test func aTakenEventNameGetsTheNextFreeNumber() async throws {
        let raced = Locked(false)
        server.reply = { request in
            switch (request.httpMethod, request.url?.path) {
            case ("GET", "/api/me/hops"):
                // Another device takes "prague-open-3" between the look and the create.
                let taken = raced.value
                    ? ["prague-open", "prague-open-2", "prague-open-3"]
                    : ["prague-open", "prague-open-2"]
                return (200, #"{"hops":[\#(taken.map { hopJSON($0) }.joined(separator: ","))]}"#)
            case ("POST", "/api/me/hops"):
                if !raced.value {
                    raced.value = true
                    return (409, #"{"error":"slug_taken","message":"You already have a Hop with that link."}"#)
                }
                return (201, #"{"hop":\#(hopJSON("jam", slug: "prague-open-4", title: "Prague Open"))}"#)
            case ("POST", "/api/me/hops/jam/activate"):
                return (200, activated)
            default:
                return (404, "{}")
            }
        }
        let mode = eventMode()
        try await mode.start(.newEvent(title: "Prague Open"), me: me(), api: server.client(token: "hs_t"))

        #expect(mode.run?.hopId == "jam")
        let creates = server.requests.filter { $0.request.httpMethod == "POST" && path($0.request) == "/api/me/hops" }
        #expect(creates.map { body($0)?["slug"] as? String } == ["prague-open-3", "prague-open-4"])
        #expect(creates.allSatisfy { body($0)?["title"] as? String == "Prague Open" })
    }

    @Test func clipsCountFromWhenTheServerMadeTheEventLive() async throws {
        let arrivals = Locked(arrivalsJSON(0, []))
        serve(arrivals: arrivals)
        let mode = eventMode()
        let api = server.client(token: "hs_t")
        try await mode.start(.existing(jam(files: 12)), me: me(), api: api)
        #expect(!server.requests.contains { $0.request.httpMethod == "POST" && path($0.request) == "/api/me/hops" })

        // Nothing new: no clips, no celebration, nothing to tell the Lock Screen.
        await mode.poll(api: api)
        #expect(mode.clips == 0)
        #expect(mode.arrival == nil)
        #expect(activity.updates.isEmpty)
        let check = try #require(server.requests.last { path($0.request) == "/api/me/hops/jam/arrivals" })
        #expect(check.request.url?.query() == "since=\(activatedAt)")

        arrivals.value = arrivalsJSON(2, [("c2", "@mia"), ("c1", "SmokyMonkey441")])
        await mode.poll(api: api)
        #expect(mode.clips == 2)
        #expect(mode.latest == "@mia")
        #expect(mode.arrival?.count == 2)
        #expect(mode.arrival?.senders == ["@mia", "SmokyMonkey441"])
        #expect(mode.arrival?.headline == "@mia and 1 more")
        #expect(mode.arrival?.announcement == "@mia and 1 other sent clips")
        #expect(activity.updates == [.init(clips: 2, latest: "@mia")])

        // The same clips aren't celebrated twice.
        let celebrated = mode.arrival?.id
        await mode.poll(api: api)
        #expect(mode.arrival?.id == celebrated)
        #expect(activity.updates.count == 1)
    }

    @Test func aBigBurstIsCountedInFullThoughOnlyTheNewestAreNamed() async throws {
        let arrivals = Locked(arrivalsJSON(0, []))
        serve(arrivals: arrivals)
        let mode = eventMode()
        let api = server.client(token: "hs_t")
        try await mode.start(.existing(jam()), me: me(), api: api)

        arrivals.value = arrivalsJSON(75, (0..<10).map { ("c\(75 - $0)", "#\(75 - $0)") })
        await mode.poll(api: api)
        #expect(mode.clips == 75)
        #expect(mode.arrival?.count == 75)
        #expect(mode.arrival?.headline == "#75 and 74 more")
    }

    @Test func aReplyThatArrivesAfterEndingChangesNothing() async throws {
        serve(arrivals: Locked(arrivalsJSON(3, [("c3", "@mia")])))
        let mode = eventMode()
        let api = server.client(token: "hs_t")
        try await mode.start(.existing(jam()), me: me(), api: api)

        server.held = ["/api/me/hops/jam/arrivals"]
        let polling = Task { await mode.poll(api: api) }
        try await server.waitForRequest("/api/me/hops/jam/arrivals")
        await mode.end()
        server.release()
        await polling.value

        #expect(mode.run == nil)
        #expect(mode.clips == 0)
        #expect(mode.arrival == nil)
        #expect(activity.updates.isEmpty)
    }

    @Test func aCheckCutShortIsNotBeingOffline() async throws {
        serve(arrivals: Locked(arrivalsJSON(0, [])))
        let mode = eventMode()
        let api = server.client(token: "hs_t")
        try await mode.start(.existing(jam()), me: me(), api: api)

        // The stage opening or closing restarts the checks, cancelling one.
        server.held = ["/api/me/hops/jam/arrivals"]
        let polling = Task { await mode.poll(api: api) }
        try await server.waitForRequest("/api/me/hops/jam/arrivals")
        polling.cancel()
        await polling.value
        server.release()

        #expect(!mode.isOffline)
        #expect(mode.run != nil)
    }

    @Test func endingStopsEverythingButKeepsTheLinkOnTheEvent() async throws {
        serve(arrivals: Locked(arrivalsJSON(0, [])))
        let mode = eventMode()
        try await mode.start(.existing(jam()), me: me(), api: server.client(token: "hs_t"))
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
        try await relaunched.resume(for: me(), api: server.client(token: "hs_t"))
        #expect(relaunched.run == nil)
    }

    @Test func aRunningEventResumesOnlyForItsAthleteAndUntilItRunsOut() async throws {
        serve(arrivals: Locked(arrivalsJSON(0, [])))
        try await eventMode().start(.existing(jam()), me: me(), api: server.client(token: "hs_t"))

        // Relaunched, same athlete.
        let relaunched = eventMode()
        try await relaunched.resume(for: me(), api: server.client(token: "hs_t"))
        #expect(relaunched.run?.hopId == "jam")
        #expect(relaunched.run?.since == Double(activatedAt))

        // Someone else signed in: it's not theirs, and it's gone for good.
        let someoneElse = eventMode()
        let endsBefore = activity.ends
        try await someoneElse.resume(for: me(id: "usr_2"), api: server.client(token: "hs_t"))
        #expect(someoneElse.run == nil)
        #expect(activity.ends == endsBefore + 1)
        let again = eventMode()
        try await again.resume(for: me(), api: server.client(token: "hs_t"))
        #expect(again.run == nil)
    }

    @Test func afterARelaunchItCatchesUpWithoutCelebrating() async throws {
        let arrivals = Locked(arrivalsJSON(0, []))
        let online = Locked(true)
        server.reply = { request in
            switch request.url?.path {
            case "/api/me/hops/jam/activate": (200, activated)
            case "/api/me/hops/jam/arrivals" where online.value: (200, arrivals.value)
            case "/api/me/hops/jam/arrivals": (503, "{}")
            default: (404, "{}")
            }
        }
        let api = server.client(token: "hs_t")
        try await eventMode().start(.existing(jam()), me: me(), api: api)

        // Two clips land while the app is shut, and the first check fails.
        arrivals.value = arrivalsJSON(2, [("c2", "@mia"), ("c1", "@leo")])
        online.value = false
        let relaunched = eventMode()
        try await relaunched.resume(for: me(), api: server.client(token: "hs_t"))
        await relaunched.poll(api: api)
        #expect(relaunched.isOffline)

        // The next one catches up, still quietly.
        online.value = true
        await relaunched.poll(api: api)
        #expect(relaunched.clips == 2)
        #expect(relaunched.latest == "@mia")
        #expect(relaunched.arrival == nil)
        #expect(activity.updates.last == .init(clips: 2, latest: "@mia"))

        // From then on, new clips are celebrated as usual.
        arrivals.value = arrivalsJSON(3, [("c3", "Mum"), ("c2", "@mia"), ("c1", "@leo")])
        await relaunched.poll(api: api)
        #expect(relaunched.clips == 3)
        #expect(relaunched.arrival?.senders == ["Mum"])
        #expect(relaunched.arrival?.headline == "Mum sent a clip")
    }

    @Test func settlesOnceItHasCaughtUpWithTheLaunch() async throws {
        serve(arrivals: Locked(arrivalsJSON(0, [])))
        let api = server.client(token: "hs_t")

        // Nothing was running: settled once it has looked.
        let fresh = eventMode()
        #expect(!fresh.hasSettled)
        try await fresh.resume(for: me(), api: api)
        #expect(fresh.hasSettled)

        // An event was running: settled once it's back.
        try await eventMode().start(.existing(jam()), me: me(), api: api)
        let relaunched = eventMode()
        #expect(!relaunched.hasSettled)
        try await relaunched.resume(for: me(), api: api)
        #expect(relaunched.hasSettled)
        #expect(relaunched.run != nil)

        // Signing out unsettles it for whoever signs in next.
        await relaunched.reset()
        #expect(!relaunched.hasSettled)
    }

    @Test func anEventRunsOutAfterTwelveHours() async throws {
        serve(arrivals: Locked(arrivalsJSON(0, [])))
        try await eventMode().start(.existing(jam()), me: me(), api: server.client(token: "hs_t"))

        clock.value = start + EventMode.maxDuration - 60
        let soon = eventMode()
        try await soon.resume(for: me(), api: server.client(token: "hs_t"))
        #expect(soon.run != nil)

        clock.value = start + EventMode.maxDuration
        let late = eventMode()
        try await late.resume(for: me(), api: server.client(token: "hs_t"))
        #expect(late.run == nil)
    }

    @Test func aDeletedEventEndsEventMode() async throws {
        server.reply = { request in
            request.url?.path == "/api/me/hops/jam/activate"
                ? (200, activated)
                : (404, #"{"error":"not_found"}"#)
        }
        let mode = eventMode()
        let api = server.client(token: "hs_t")
        try await mode.start(.existing(jam()), me: me(), api: api)

        await mode.poll(api: api)
        #expect(mode.run == nil)
    }

    @Test func goingOfflineShowsAndComesBack() async throws {
        let online = Locked(true)
        server.reply = { request in
            switch request.url?.path {
            case "/api/me/hops/jam/activate": (200, activated)
            case "/api/me/hops/jam/arrivals" where online.value: (200, arrivalsJSON(0, []))
            case "/api/me/hops/jam/arrivals": (503, "{}")
            default: (404, "{}")
            }
        }
        let mode = eventMode()
        let api = server.client(token: "hs_t")
        try await mode.start(.existing(jam()), me: me(), api: api)

        online.value = false
        await mode.poll(api: api)
        #expect(mode.isOffline)
        #expect(mode.run != nil)

        online.value = true
        await mode.poll(api: api)
        #expect(!mode.isOffline)
    }
}

@MainActor
@Suite("Event mode push updates", .serialized)
struct EventPushTests {
    let server = StubServer(host: "event-push.test")
    let defaults = UserDefaults(suiteName: "event-push-tests-\(UUID().uuidString)")!
    let activity = FakeEventActivity()
    let tokenA = String(repeating: "a1", count: 40)
    let tokenB = String(repeating: "b2", count: 40)

    private func eventMode() -> EventMode {
        EventMode(defaults: defaults, activity: activity, now: { start })
    }

    private func registrations(_ token: String? = nil) -> [(request: URLRequest, body: Data)] {
        server.requests.filter { entry in
            entry.request.httpMethod == "PUT"
                && entry.request.url?.path.hasPrefix("/api/me/live-activities/\(token ?? "")") == true
        }
    }

    /// Answers activation and arrivals; live-activity registrations with `register`.
    private func serve(register: Locked<(Int, String)> = Locked((200, #"{"ok":true}"#))) {
        server.reply = { request in
            switch (request.httpMethod, request.url?.path ?? "") {
            case ("POST", "/api/me/hops/jam/activate"): return (200, activated)
            case ("GET", "/api/me/hops/jam/arrivals"): return (200, arrivalsJSON(0, []))
            case ("PUT", let path) where path.hasPrefix("/api/me/live-activities/"): return register.value
            case ("DELETE", let path) where path.hasPrefix("/api/me/live-activities/"): return (200, #"{"ok":true}"#)
            default: return (404, "{}")
            }
        }
    }

    @Test func eachPushTokenIsRegisteredAndForgottenOnEnd() async throws {
        serve()
        let mode = eventMode()
        try await mode.start(.existing(jam()), me: me(), api: server.client(token: "hs_t"))

        activity.issue(tokenA)
        try await server.waitForRequests { $0.httpMethod == "PUT" }
        let body = try #require(registrations(tokenA).first.map { try JSONSerialization.jsonObject(with: $0.body) as? [String: Any] })
        #expect(body?["hopId"] as? String == "jam")
        #expect(body?["since"] as? Int == activatedAt)
        #expect(body?["environment"] as? String == "sandbox")

        // Apple rotates the token: the new one is registered too.
        activity.issue(tokenB)
        try await server.waitForRequests(count: 2) { $0.httpMethod == "PUT" }
        #expect(registrations(tokenB).count == 1)

        await mode.end()
        try await server.waitForRequests { $0.httpMethod == "DELETE" }
        let forgotten = server.requests.filter { $0.request.httpMethod == "DELETE" }
        #expect(forgotten.map { $0.request.url?.path } == ["/api/me/live-activities/\(tokenB)"])
    }

    @Test func aFailedRegistrationIsTriedAgainOnTheNextCheck() async throws {
        let register = Locked((503, "{}"))
        serve(register: register)
        let mode = eventMode()
        let api = server.client(token: "hs_t")
        try await mode.start(.existing(jam()), me: me(), api: api)
        activity.issue(tokenA)
        try await server.waitForRequests { $0.httpMethod == "PUT" }

        register.value = (200, #"{"ok":true}"#)
        await mode.poll(api: api)
        #expect(registrations(tokenA).count == 2)

        // Registered now: later checks leave it be.
        await mode.poll(api: api)
        #expect(registrations(tokenA).count == 2)
    }

    @Test func aSlowRegistrationNeverHoldsUpTheLockScreen() async throws {
        let register = Locked((503, "{}"))
        let arrived = Locked(arrivalsJSON(0, []))
        server.reply = { request in
            switch (request.httpMethod, request.url?.path ?? "") {
            case ("POST", "/api/me/hops/jam/activate"): return (200, activated)
            case ("GET", "/api/me/hops/jam/arrivals"): return (200, arrived.value)
            case ("PUT", let path) where path.hasPrefix("/api/me/live-activities/"): return register.value
            default: return (404, "{}")
            }
        }
        let mode = eventMode()
        let api = server.client(token: "hs_t")
        try await mode.start(.existing(jam()), me: me(), api: api)
        activity.issue(tokenA)
        try await server.waitForRequests { $0.httpMethod == "PUT" }

        // The retry hangs; the new count still reaches the Lock Screen first.
        register.value = (200, #"{"ok":true}"#)
        server.held = ["/api/me/live-activities/\(tokenA)"]
        arrived.value = arrivalsJSON(1, [("c1", "@mia")])
        let polling = Task { await mode.poll(api: api) }
        try await server.waitForRequests(count: 2) { $0.httpMethod == "PUT" }
        #expect(activity.updates == [.init(clips: 1, latest: "@mia")])
        server.release()
        await polling.value
    }

    @Test func aServerForTheOtherEnvironmentIsNotAskedAgain() async throws {
        let register = Locked((409, #"{"error":"wrong_environment","message":"Push updates aren't available for this build."}"#))
        serve(register: register)
        let mode = eventMode()
        let api = server.client(token: "hs_t")
        try await mode.start(.existing(jam()), me: me(), api: api)
        activity.issue(tokenA)
        try await server.waitForRequests { $0.httpMethod == "PUT" }

        await mode.poll(api: api)
        #expect(registrations(tokenA).count == 1)
    }

    @Test func aRelaunchRegistersTheTokenAgain() async throws {
        serve()
        let api = server.client(token: "hs_t")
        // Event mode lives as long as the app; this one until the "relaunch".
        var first: EventMode? = eventMode()
        try await first?.start(.existing(jam()), me: me(), api: api)
        activity.issue(tokenA)
        try await server.waitForRequests { $0.httpMethod == "PUT" }
        first = nil

        let relaunched = eventMode()
        try await relaunched.resume(for: me(), api: api)
        activity.issue(tokenA)
        try await server.waitForRequests(count: 2) { $0.httpMethod == "PUT" }
        #expect(registrations(tokenA).count == 2)
        #expect(first == nil)
    }
}

@Suite("Event links")
struct EventLinkTests {
    /// What `slugify` in packages/shared/src/handles.ts gives for each title.
    @Test(arguments: [
        ("Prague Open", "prague-open"),
        ("Mistrovství ČR 2026", "mistrovstvi-cr-2026"),
        ("  --Hello__World!!  ", "hello-world"),
        ("Ünïcödé Straße", "unicode-stra-e"),
        ("東京オープン", ""),
        ("🔥🔥", ""),
        ("Sunday 15 November", "sunday-15-november"),
        ("The Very Long International Rope Skipping Championship Finals Day Two", "the-very-long-international-rope-skippin"),
        ("İstanbul Kelvin\u{212A}", "istanbul-kelvink"),
        ("a\u{20D7}b", "a-b"),
    ])
    func matchesTheWebsite(title: String, slug: String) {
        #expect(EventLink.slug(title) == slug)
    }

    @Test func titlesWithNothingALinkCanUseBecomeEvent() {
        #expect(EventLink.free(for: "東京オープン", taken: []) == "event")
        #expect(EventLink.free(for: "🔥", taken: ["event", "event-2"]) == "event-3")
    }

    @Test func longNamesMakeRoomForTheNumber() {
        let title = "The Very Long International Rope Skipping Championship Finals Day Two"
        let base = "the-very-long-international-rope-skippin"
        #expect(EventLink.free(for: title, taken: []) == base)
        #expect(EventLink.free(for: title, taken: [base]) == "the-very-long-international-rope-skipp-2")
        // Always fits, and never leaves a dash before the number.
        let taken = Set([base] + (2...9).map { "the-very-long-international-rope-skipp-\($0)" })
        let tenth = EventLink.free(for: title, taken: taken)
        #expect(tenth == "the-very-long-international-rope-skip-10")
        #expect(tenth.count <= EventLink.maxLength)
        #expect(tenth.wholeMatch(of: /[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?/) != nil)
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
