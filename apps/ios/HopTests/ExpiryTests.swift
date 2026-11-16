import Foundation
import Testing
import UserNotifications
@testable import Hop

/// Stands in for the system's notification center.
private final class FakeCenter: NotificationCenterProtocol, @unchecked Sendable {
    var status: UNAuthorizationStatus
    var allows: Bool
    private(set) var asked = 0

    init(status: UNAuthorizationStatus = .notDetermined, allows: Bool = true) {
        self.status = status
        self.allows = allows
    }

    func authorizationStatus() async -> UNAuthorizationStatus { status }

    func requestAuthorization(options: UNAuthorizationOptions) async throws -> Bool {
        asked += 1
        status = allows ? .authorized : .denied
        return allows
    }
}

@MainActor
@Suite("Notifications", .serialized)
struct NotificationsTests {
    let server = StubServer(host: "push-\(UUID().uuidString.lowercased()).test")
    let token = Data([0xde, 0xad, 0xbe, 0xef])

    private func make(_ center: FakeCenter, registered: Locked<Int> = Locked(0)) -> PushNotifications {
        let defaults = UserDefaults(suiteName: "NotificationsTests.\(UUID().uuidString)")!
        return PushNotifications(defaults: defaults, center: center) { registered.value += 1 }
    }

    @Test func asksAppleForATokenOnlyWhenAllowed() async {
        let registered = Locked(0)
        await make(FakeCenter(status: .notDetermined), registered: registered).start(api: server.client())
        #expect(registered.value == 0)
        await make(FakeCenter(status: .denied), registered: registered).start(api: server.client())
        #expect(registered.value == 0)
        await make(FakeCenter(status: .authorized), registered: registered).start(api: server.client())
        #expect(registered.value == 1)
    }

    @Test func sendsTheTokenToTheAPIForWhoeverIsSignedIn() async throws {
        server.reply = { _ in (200, #"{"ok":true}"#) }
        let push = make(FakeCenter(status: .authorized))
        await push.start(api: server.client(token: "hs_test"))
        await push.received(token)
        #expect(push.token == "deadbeef")
        let request = try #require(server.requests.last?.request)
        #expect(request.httpMethod == "PUT")
        #expect(request.url?.path == "/api/me/devices/deadbeef")
        #expect(request.value(forHTTPHeaderField: "Authorization") == "Bearer hs_test")
        let sent = try #require(server.requests.last?.body)
        let body = try #require(try JSONSerialization.jsonObject(with: sent) as? [String: String])
        #expect(body == ["environment": "sandbox"])
    }

    @Test func keepsATokenThatCameWhileSignedOutWithoutSendingIt() async {
        let push = make(FakeCenter(status: .authorized))
        await push.received(token)
        #expect(push.token == "deadbeef")
        #expect(server.requests.isEmpty)
        // Signed out after being in: nothing more is sent.
        await push.start(api: server.client())
        push.stop()
        await push.received(token)
        #expect(server.requests.isEmpty)
    }

    @Test func asksOnceFromTheCardAndRegistersIfAllowed() async {
        let registered = Locked(0)
        let center = FakeCenter()
        let push = make(center, registered: registered)
        #expect(push.shouldAsk)
        #expect(await push.ask())
        #expect(registered.value == 1)
        #expect(push.authorization == .authorized)
        #expect(!push.shouldAsk)

        let declined = make(FakeCenter(allows: false), registered: registered)
        #expect(await declined.ask() == false)
        #expect(registered.value == 1)
        #expect(!declined.shouldAsk)
    }

    @Test func remembersTheCardWasPutAway() {
        let defaults = UserDefaults(suiteName: "NotificationsTests.\(UUID().uuidString)")!
        let push = PushNotifications(defaults: defaults, center: FakeCenter()) {}
        push.dismissAsk()
        #expect(!push.shouldAsk)
        let later = PushNotifications(defaults: defaults, center: FakeCenter()) {}
        #expect(!later.shouldAsk)
    }

    @Test func letsGoOfThePhoneOnSignOut() async throws {
        server.reply = { _ in (200, #"{"ok":true}"#) }
        let push = make(FakeCenter(status: .authorized))
        await push.start(api: server.client())
        await push.received(token)
        await push.unregister(api: server.client(token: "hs_test"))
        let request = try #require(server.requests.last?.request)
        #expect(request.httpMethod == "DELETE")
        #expect(request.url?.path == "/api/me/devices/deadbeef")
        // And sends nothing more until someone signs in.
        let before = server.requests.count
        await push.received(token)
        #expect(server.requests.count == before)
    }

    @Test func shrugsOffABuildTheServerCantPushTo() async {
        server.reply = { _ in (409, #"{"error":"wrong_environment","message":"No."}"#) }
        let push = make(FakeCenter(status: .authorized))
        await push.start(api: server.client())
        await push.received(token)
        #expect(push.token == "deadbeef")
    }
}

@MainActor
@Suite("Signing out with notifications", .serialized)
struct SignOutOrderTests {
    let server = StubServer(host: "signout-\(UUID().uuidString.lowercased()).test")

    @Test func unregistersThePhoneBeforeTheSessionEnds() async throws {
        server.reply = { _ in (200, #"{"ok":true}"#) }
        let defaults = UserDefaults(suiteName: "SignOutOrderTests.\(UUID().uuidString)")!
        defaults.set(true, forKey: "session.installed")
        let session = Session(
            store: MemoryTokenStore("tok_saved"), baseURL: server.baseURL,
            urlSession: server.urlSession(), defaults: defaults
        )
        await session.signOut { client in
            try? await client.delete("api/me/devices/deadbeef")
        }
        #expect(!session.isSignedIn)
        #expect(server.requests.map { $0.request.url?.path } == ["/api/me/devices/deadbeef", "/api/auth/logout"])
        #expect(server.requests.allSatisfy { $0.request.value(forHTTPHeaderField: "Authorization") == "Bearer tok_saved" })
    }
}

@Suite("Clips about to expire")
struct ExpiryNudgeTests {
    private func calendar(_ zone: String, _ identifier: Calendar.Identifier = .gregorian) -> Calendar {
        var calendar = Calendar(identifier: identifier)
        calendar.timeZone = TimeZone(identifier: zone)!
        return calendar
    }
    /// Friday 15 January 2027, 08:00 UTC.
    private let now = Date(timeIntervalSince1970: 1_800_000_000)

    private func expiring(_ clips: Int, on day: String) -> PlanStatus.Expiring {
        .init(clips: clips, on: day, at: 0)
    }

    @Test func saysHowManyAndWhichDay() {
        let utc = calendar("UTC")
        #expect(ExpiryNudge.title(expiring(12, on: "2027-01-22"), now: now, calendar: utc).hasPrefix("12 clips leave on "))
        #expect(ExpiryNudge.title(expiring(12, on: "2027-01-22"), now: now, calendar: utc).contains("22"))
        #expect(ExpiryNudge.title(expiring(1, on: "2027-01-22"), now: now, calendar: utc).hasPrefix("1 clip leaves on "))
        #expect(ExpiryNudge.title(expiring(3, on: "2027-01-16"), now: now, calendar: utc) == "3 clips leave tomorrow")
        #expect(ExpiryNudge.title(expiring(1, on: "2027-01-15"), now: now, calendar: utc) == "1 clip leaves today")
        // Already past here, but not everywhere: they haven't gone yet.
        #expect(ExpiryNudge.title(expiring(1, on: "2027-01-14"), now: now, calendar: utc) == "1 clip leaves today")
    }

    @Test func readsTheDayWhereTheAthleteIs() {
        // 05:00 UTC on the 15th is still the evening of the 14th in Los Angeles:
        // the day the email named, the 15th, is tomorrow there.
        let early = Date(timeIntervalSince1970: 1_799_989_200)
        #expect(ExpiryNudge.title(expiring(2, on: "2027-01-15"), now: early, calendar: calendar("America/Los_Angeles")) == "2 clips leave tomorrow")
        #expect(ExpiryNudge.title(expiring(2, on: "2027-01-15"), now: early, calendar: calendar("UTC")) == "2 clips leave today")
    }

    @Test func readsTheAPIsDateWhateverCalendarThePhoneUses() {
        for identifier: Calendar.Identifier in [.buddhist, .japanese, .islamicUmmAlQura, .hebrew] {
            let phone = calendar("UTC", identifier)
            #expect(ExpiryNudge.title(expiring(2, on: "2027-01-16"), now: now, calendar: phone) == "2 clips leave tomorrow")
            #expect(ExpiryNudge.title(expiring(2, on: "2027-01-22"), now: now, calendar: phone).hasPrefix("2 clips leave on "))
        }
    }

    @Test func readsThePlan() throws {
        func status(_ expiring: String?) -> String {
            """
            {"plan":"free","storage":{"usedBytes":0,"limitBytes":1},"retentionDays":30,"subscription":null,
             "appAccountToken":"1b4e28ba-2fa1-11d2-883f-0016d3cca427",
             "plans":{"free":{"storageBytes":1,"retentionDays":30},"plus":{"storageBytes":2,"retentionDays":null}},
             "revision":1\(expiring.map { #","expiring":\#($0)"# } ?? "")}
            """
        }
        let withIt = try JSONDecoder().decode(PlanStatus.self, from: Data(status(#"{"clips":4,"on":"2027-01-22","at":1800705600000}"#).utf8))
        #expect(withIt.expiring == PlanStatus.Expiring(clips: 4, on: "2027-01-22", at: 1_800_705_600_000))
        #expect(withIt.expiring?.day(in: calendar("UTC")) == Date(timeIntervalSince1970: 1_800_576_000))
        // Older servers don't say.
        let without = try JSONDecoder().decode(PlanStatus.self, from: Data(status(nil).utf8))
        #expect(without.expiring == nil)
    }
}
