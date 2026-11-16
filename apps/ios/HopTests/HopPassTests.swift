import CoreGraphics
import Foundation
import Testing
import UIKit
@testable import Hop

@MainActor
@Suite("Hop pass")
struct HopPassTests {
    private let me = Me(
        id: "usr_1", name: "Maya Rivera", email: nil, handle: "maya",
        activeHopId: nil, color: "coral", emailNewClips: true
    )

    @Test func countsClipsAndEventsAcrossEveryEvent() throws {
        let hops = try JSONDecoder().decode([Hop].self, from: Data("""
            [{"id":"a","slug":"a","title":"A","status":"open","createdAt":1,"fileCount":1,"totalBytes":0},
             {"id":"b","slug":"b","title":"B","status":"closed","createdAt":2,"fileCount":127,"totalBytes":0}]
            """.utf8))
        let stats = PassStats(hops: hops)
        #expect(stats == PassStats(clips: 128, events: 2))
        #expect(stats.clipsText == "128 clips")
        #expect(stats.eventsText == "2 events")
        #expect(PassStats(clips: 1, events: 1).clipsText == "1 clip")
        #expect(PassStats(clips: 1, events: 1).eventsText == "1 event")
    }

    @Test func rendersAStoryForSharing() throws {
        let image = try #require(PassStory.image(
            me: me, link: URL(string: "https://onmyhop.com/maya")!, stats: PassStats(clips: 3, events: 1)
        ))
        #expect(image.size.width * image.scale == 1080)
        #expect(image.size.height * image.scale == 1920)
    }

    @Test func tiltFollowsTheHandAndSettles() {
        let rest = CGPoint(x: 0, y: -0.7)
        // Tipped right by a full range: a full tilt.
        let (tilt, settled) = Tilt.step(gravity: CGPoint(x: Tilt.range, y: -0.7), rest: rest)
        #expect(tilt.x == 1)
        #expect(tilt.y == 0)
        // The resting pose moves a little towards the new angle.
        #expect(settled.x > 0 && settled.x < Tilt.range)
        // Never beyond -1…1.
        #expect(Tilt.step(gravity: CGPoint(x: -3, y: 2), rest: .zero).tilt == CGPoint(x: -1, y: 1))
        // Held still, it settles back to no tilt.
        var pose = rest
        var latest = CGPoint.zero
        for _ in 0..<400 {
            (latest, pose) = Tilt.step(gravity: CGPoint(x: 0.3, y: -0.5), rest: pose)
        }
        #expect(abs(latest.x) < 0.01 && abs(latest.y) < 0.01)
    }
}
