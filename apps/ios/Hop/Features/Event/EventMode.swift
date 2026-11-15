import Foundation
import Observation

/// An event Event mode is running for: where clips go, and since when.
nonisolated struct EventRun: Codable, Equatable, Sendable {
    /// The athlete it belongs to, so it never carries over to another account.
    let userId: String
    let hopId: String
    let title: String
    let startedAt: Date
    /// The event's clip count when Event mode started. Only clips after
    /// that count, so an event already in use starts from zero.
    let baseline: Int
}

/// Event mode: the athlete's QR code full screen, the screen kept on, and
/// a count of the clips coming in, in the app and as a Live Activity.
///
/// It lives as long as the app, outside any screen, so the running event
/// survives switching tabs and relaunching.
@Observable
final class EventMode {
    /// Where the clips should go when Event mode starts.
    enum Target: Hashable {
        /// A new event with this name, which the link then uploads into.
        case newEvent(title: String)
        /// An event the athlete already has.
        case existing(Hop)
    }

    /// Clips that came in together, for one "Mia sent a clip" moment.
    struct Arrival: Identifiable, Equatable {
        let id = UUID()
        /// Who sent them, newest first.
        let senders: [String]
    }

    private(set) var run: EventRun?
    /// Clips sent since Event mode started.
    private(set) var clips = 0
    /// Who sent the latest clip.
    private(set) var latest: String?
    /// The newest burst of clips, for the screens to celebrate.
    private(set) var arrival: Arrival?
    /// Set while the server can't be reached.
    private(set) var isOffline = false
    /// Whether the full-screen QR code is showing.
    var isStagePresented = false

    /// Events stop on their own after this long, like a Live Activity does.
    static let maxDuration: TimeInterval = 12 * 60 * 60

    private let defaults: UserDefaults
    private let activity: EventActivityControlling
    private let now: () -> Date
    /// Clips already announced, so none is celebrated twice.
    private var announced: Set<String> = []
    /// Set when an event resumes after a relaunch, so the first check
    /// catches up quietly instead of celebrating clips from while it was shut.
    private var catchingUp = false
    /// Bumped whenever the run starts, ends or is reset, so an answer to an
    /// older request can't change the current one.
    private var generation = 0

    private static let runKey = "event.run"

    init(
        defaults: UserDefaults = .standard,
        activity: EventActivityControlling = LiveEventActivity(),
        now: @escaping () -> Date = Date.init
    ) {
        self.defaults = defaults
        self.activity = activity
        self.now = now
    }

    /// Picks up an event that was running when the app last quit, if it
    /// belongs to this athlete and hasn't run out. Otherwise clears it, and
    /// any Live Activity left behind.
    func resume(for me: Me) async {
        if let run {
            if run.userId != me.id { await reset() }
            return
        }
        if let data = defaults.data(forKey: Self.runKey),
           let saved = try? JSONDecoder().decode(EventRun.self, from: data),
           saved.userId == me.id,
           now().timeIntervalSince(saved.startedAt) < Self.maxDuration {
            generation += 1
            run = saved
            catchingUp = true
            return
        }
        await reset()
    }

    /// Starts Event mode: points the athlete's link at the event, then
    /// starts counting.
    func start(_ target: Target, me: Me, api: APIClient) async throws {
        generation += 1
        let asked = generation
        let hop: Hop
        switch target {
        case let .newEvent(title):
            hop = try await create(title: title, api: api)
        case let .existing(existing):
            hop = existing
        }
        try await api.post("api/me/hops/\(hop.id)/activate")
        // Ended, reset or started again while this was on its way.
        guard asked == generation, let link = me.link else { return }

        let started = EventRun(
            userId: me.id,
            hopId: hop.id,
            title: hop.title,
            startedAt: now(),
            baseline: hop.fileCount
        )
        run = started
        clips = 0
        latest = nil
        arrival = nil
        announced = []
        catchingUp = false
        isOffline = false
        save()
        // This event's Live Activity replaces any earlier one.
        await activity.end()
        guard asked == generation else { return }
        activity.start(EventActivityAttributes(
            title: started.title,
            link: link,
            color: me.color,
            startedAt: started.startedAt
        ))
    }

    /// Stops Event mode. The link keeps uploading into the event, for the
    /// clips people send on the way home.
    func end() async {
        generation += 1
        run = nil
        clips = 0
        latest = nil
        arrival = nil
        isOffline = false
        isStagePresented = false
        announced = []
        defaults.removeObject(forKey: Self.runKey)
        await activity.end()
    }

    /// Ends Event mode when its athlete signs out.
    func reset() async {
        await end()
    }

    /// Checks for new clips once.
    func poll(api: APIClient) async {
        guard let current = run else { return }
        let asked = generation
        if now().timeIntervalSince(current.startedAt) >= Self.maxDuration {
            await end()
            return
        }
        do {
            let reply: HopsReply = try await api.get("api/me/hops")
            guard asked == generation else { return }
            guard let hop = reply.hops.first(where: { $0.id == current.hopId }) else {
                // The event was deleted, on the website perhaps.
                await end()
                return
            }
            isOffline = false
            let quietly = catchingUp
            catchingUp = false
            let count = max(hop.fileCount - current.baseline, 0)
            guard count != clips else { return }
            var senders: [String] = []
            if count > clips {
                let page: ClipPage = try await api.get(
                    "api/me/files",
                    query: [URLQueryItem(name: "hopId", value: current.hopId)]
                )
                guard asked == generation else { return }
                // Newest first. Clips from before Event mode don't count.
                let fresh = page.files.filter { clip in
                    clip.sentAt >= current.startedAt && !announced.contains(clip.id)
                }
                announced.formUnion(fresh.map(\.id))
                senders = fresh.map(\.contributor)
            }
            let grew = count > clips
            clips = count
            if let newest = senders.first { latest = newest }
            if grew, !quietly { arrival = Arrival(senders: senders) }
            await activity.update(.init(clips: clips, latest: latest))
        } catch {
            guard asked == generation else { return }
            isOffline = true
        }
    }

    /// Checks for new clips every `interval` until cancelled.
    func watch(api: APIClient, every interval: Duration) async {
        while !Task.isCancelled, run != nil {
            await poll(api: api)
            try? await Task.sleep(for: interval)
        }
    }

    /// Creates the event. Its link name comes from the title; when the
    /// athlete already has one by that name, the next free number is added.
    private func create(title: String, api: APIClient) async throws -> Hop {
        var attempt = 1
        while true {
            let body = NewHop(title: title, slug: attempt == 1 ? nil : "\(title) \(attempt)")
            do {
                let reply: HopReply = try await api.post("api/me/hops", body: body)
                return reply.hop
            } catch let error as APIError where error.code == "slug_taken" && attempt < 20 {
                attempt += 1
            }
        }
    }

    private func save() {
        guard let run, let data = try? JSONEncoder().encode(run) else { return }
        defaults.set(data, forKey: Self.runKey)
    }

    private struct NewHop: Encodable {
        let title: String
        let slug: String?
    }

    private struct HopReply: Decodable {
        let hop: Hop
    }

    private struct HopsReply: Decodable {
        let hops: [Hop]
    }
}

extension EventMode.Arrival {
    /// Short, for the pill: "Mia sent a clip", "Mia and 2 more".
    var headline: String {
        guard let first = senders.first else { return String(localized: "New clips") }
        return senders.count == 1
            ? String(localized: "\(first) sent a clip")
            : String(localized: "\(first) and \(senders.count - 1) more")
    }

    /// In full, for VoiceOver: "Mia and 2 others sent clips".
    var announcement: String {
        guard let first = senders.first else { return String(localized: "New clips arrived") }
        switch senders.count {
        case 1: return String(localized: "\(first) sent a clip")
        case 2: return String(localized: "\(first) and 1 other sent clips")
        default: return String(localized: "\(first) and \(senders.count - 1) others sent clips")
        }
    }
}
