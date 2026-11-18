package com.onmyhop.app

import android.content.SharedPreferences
import com.onmyhop.app.core.ApiClient
import com.onmyhop.app.core.Me
import com.onmyhop.app.feature.event.EventLink
import com.onmyhop.app.feature.event.EventMode
import com.onmyhop.app.feature.event.EventNotifier
import kotlinx.coroutines.runBlocking
import mockwebserver3.Dispatcher
import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer
import mockwebserver3.RecordedRequest
import okhttp3.OkHttpClient
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

class EventLinkTest {
    /** What `slugify` in packages/shared/src/handles.ts gives for each title (as the iPhone app checks). */
    @Test
    fun matchesTheWebsite() {
        mapOf(
            "Prague Open" to "prague-open",
            "Mistrovství ČR 2026" to "mistrovstvi-cr-2026",
            "  --Hello__World!!  " to "hello-world",
            "Ünïcödé Straße" to "unicode-stra-e",
            "東京オープン" to "",
            "🔥🔥" to "",
            "Sunday 15 November" to "sunday-15-november",
            "The Very Long International Rope Skipping Championship Finals Day Two" to "the-very-long-international-rope-skippin",
            "İstanbul KelvinK" to "istanbul-kelvink",
            "a⃗b" to "a-b",
        ).forEach { (title, slug) -> assertEquals(title, slug, EventLink.slug(title)) }
    }

    @Test
    fun titlesWithNothingALinkCanUseBecomeEvent() {
        assertEquals("event", EventLink.free("東京オープン", emptySet()))
        assertEquals("event-3", EventLink.free("🔥", setOf("event", "event-2")))
    }

    @Test
    fun longNamesMakeRoomForTheNumber() {
        val title = "The Very Long International Rope Skipping Championship Finals Day Two"
        val base = "the-very-long-international-rope-skippin"
        assertEquals(base, EventLink.free(title, emptySet()))
        assertEquals("the-very-long-international-rope-skipp-2", EventLink.free(title, setOf(base)))
        val taken = setOf(base) + (2..9).map { "the-very-long-international-rope-skipp-$it" }
        val tenth = EventLink.free(title, taken)
        assertEquals("the-very-long-international-rope-skip-10", tenth)
        assertTrue(tenth.length <= EventLink.MAX_LENGTH)
        assertTrue(Regex("[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?").matches(tenth))
    }
}

class EventModeTest {
    private val server = MockWebServer()
    private val replies = mutableMapOf<String, String>()
    private val requests = mutableListOf<String>()
    private val notifier = RecordingNotifier()
    private val preferences = MemoryPreferences()
    private var clock = 1_000_000L
    private val me = Me(id = "u1", color = "sky", handle = "maya")

    @Before
    fun start() {
        server.dispatcher = object : Dispatcher() {
            override fun dispatch(request: RecordedRequest): MockResponse {
                val key = "${request.method} ${request.url.encodedPath}"
                synchronized(requests) { requests += key + (request.url.encodedQuery?.let { "?$it" } ?: "") }
                val body = replies[key] ?: return MockResponse.Builder().code(404).body("""{"error":"not_found"}""").build()
                return MockResponse.Builder().setHeader("Content-Type", "application/json").body(body).build()
            }
        }
        server.start()
    }

    @After
    fun stop() = server.close()

    private fun api() = ApiClient(server.url("/"), "hs_abc", OkHttpClient())
    private fun eventMode() = EventMode(preferences, notifier) { clock }

    private fun hop(id: String, slug: String, title: String) =
        """{"id":"$id","slug":"$slug","title":"$title","status":"open","createdAt":1,"fileCount":0,"totalBytes":0}"""

    private fun clip(id: String, name: String?) =
        """{"id":"$id","hopId":"h1","name":"a.mp4","mime":"video/mp4","size":1,"hasThumbnail":false,"contributorName":${name?.let { "\"$it\"" }},"createdAt":1}"""

    /** A new event gets a link name nobody has yet, the link moves to it, and counting starts from the server's clock. */
    @Test
    fun startsANewEvent() = runBlocking {
        replies["GET /api/me/hops"] = """{"hops":[${hop("h0", "prague-open", "Prague Open")}]}"""
        replies["POST /api/me/hops"] = """{"hop":${hop("h1", "prague-open-2", "Prague Open")}}"""
        replies["POST /api/me/hops/h1/activate"] = """{"ok":true,"activatedAt":555}"""
        val mode = eventMode()
        mode.start(EventMode.Target.NewEvent("Prague Open"), me, api())
        val run = mode.run
        assertNotNull(run)
        assertEquals("h1", run!!.hopId)
        assertEquals(555L, run.since)
        assertEquals(clock, run.startedAt)
        assertTrue(server.takeRequest().url.encodedPath == "/api/me/hops")
        assertTrue(server.takeRequest().body!!.utf8().contains(""""slug":"prague-open-2""""))
        assertEquals(0, notifier.shown.last().second)
    }

    /** Clips are counted from the event's start, and each burst is celebrated once. */
    @Test
    fun countsAndCelebratesArrivals() = runBlocking {
        replies["POST /api/me/hops/h1/activate"] = """{"ok":true,"activatedAt":555}"""
        val mode = eventMode()
        mode.start(EventMode.Target.Existing(com.onmyhop.app.core.Hop("h1", "x", "X", "open", 1, 0, 0)), me, api())

        replies["GET /api/me/hops/h1/arrivals"] = """{"count":2,"latest":[${clip("c2", "Mia")},${clip("c1", null)}]}"""
        mode.poll(api())
        assertEquals(2, mode.state.value.clips)
        assertEquals("Mia", mode.state.value.latest)
        val first = mode.state.value.arrival
        assertEquals(2, first?.count)
        assertTrue(requests.any { it == "GET /api/me/hops/h1/arrivals?since=555" })
        assertEquals(2 to "Mia", notifier.shown.last().second to notifier.shown.last().third)

        // Nothing new: no new celebration.
        mode.poll(api())
        assertEquals(first, mode.state.value.arrival)
    }

    /** After a relaunch, the same athlete's event carries on and catches up quietly; anyone else's ends. */
    @Test
    fun resumesOnlyForItsAthlete() = runBlocking {
        replies["POST /api/me/hops/h1/activate"] = """{"ok":true,"activatedAt":555}"""
        eventMode().start(EventMode.Target.Existing(com.onmyhop.app.core.Hop("h1", "x", "X", "open", 1, 0, 0)), me, api())

        val relaunched = eventMode()
        relaunched.resume(me)
        assertEquals("h1", relaunched.run?.hopId)
        replies["GET /api/me/hops/h1/arrivals"] = """{"count":3,"latest":[${clip("c3", "Ben")}]}"""
        relaunched.poll(api())
        assertEquals(3, relaunched.state.value.clips)
        assertNull("clips from while the app was shut aren't celebrated", relaunched.state.value.arrival)

        val someoneElse = eventMode()
        someoneElse.resume(me.copy(id = "u2"))
        assertNull(someoneElse.run)
        assertTrue(someoneElse.state.value.hasSettled)
        assertTrue(notifier.cleared)
    }

    /** Events stop on their own after 12 hours, as a Live Activity does. */
    @Test
    fun endsAfterTwelveHours() = runBlocking {
        replies["POST /api/me/hops/h1/activate"] = """{"ok":true,"activatedAt":555}"""
        val mode = eventMode()
        mode.start(EventMode.Target.Existing(com.onmyhop.app.core.Hop("h1", "x", "X", "open", 1, 0, 0)), me, api())
        clock += EventMode.MAX_DURATION_MS
        mode.poll(api())
        assertNull(mode.run)
        assertFalse(eventMode().also { it.resume(me) }.run != null)
    }

    /** A push moves the notification's count ahead, for the event running here only, and never back. */
    @Test
    fun pushesUpdateTheNotification() = runBlocking {
        replies["POST /api/me/hops/h1/activate"] = """{"ok":true,"activatedAt":555}"""
        val mode = eventMode()
        mode.start(EventMode.Target.Existing(com.onmyhop.app.core.Hop("h1", "x", "X", "open", 1, 0, 0)), me, api())
        mode.pushed("u1", "h1", since = 555, clips = 2, latest = "Mia", at = 1010)
        assertEquals(Triple("h1", 2, "Mia"), notifier.shown.last())
        val shown = notifier.shown.size
        mode.pushed("u1", "h1", since = 555, clips = 1, latest = null, at = 1009) // older
        mode.pushed("u1", "h2", since = 555, clips = 5, latest = null, at = 1011) // another event
        mode.pushed("u2", "h1", since = 555, clips = 5, latest = null, at = 1012) // another athlete
        assertEquals(shown, notifier.shown.size)

        // The app's own count is ahead: the notification stays with it.
        replies["GET /api/me/hops/h1/arrivals"] = """{"count":4,"latest":[${clip("c4", "Leo")}]}"""
        mode.poll(api())
        mode.pushed("u1", "h1", since = 555, clips = 3, latest = "Mia", at = 1013)
        assertEquals(Triple("h1", 4, "Leo"), notifier.shown.last())
        // The app's count stays its own, so it still celebrates what it finds.
        mode.pushed("u1", "h1", since = 555, clips = 6, latest = "Ana", at = 1014)
        assertEquals(Triple("h1", 6, "Ana"), notifier.shown.last())
        assertEquals(4, mode.state.value.clips)
    }

    /** Only the run going now: not a late update from before Event mode started again for the same event. */
    @Test
    fun pushesOnlyForThisRun() = runBlocking {
        replies["POST /api/me/hops/h1/activate"] = """{"ok":true,"activatedAt":555}"""
        val mode = eventMode()
        mode.start(EventMode.Target.Existing(com.onmyhop.app.core.Hop("h1", "x", "X", "open", 1, 0, 0)), me, api())
        mode.pushed("u1", "h1", since = 444, clips = 9, latest = null, at = 1000)
        mode.pushed("u1", "h1", since = null, clips = 9, latest = null, at = 500)
        assertEquals(Triple("h1", 0, null), notifier.shown.last())
        mode.pushed("u1", "h1", since = null, clips = 2, latest = null, at = 600)
        assertEquals(Triple("h1", 2, null), notifier.shown.last())
    }

    /** A check answered after a newer push doesn't take the notification back. */
    @Test
    fun aLateCheckDoesntLowerTheNotification() = runBlocking {
        replies["POST /api/me/hops/h1/activate"] = """{"ok":true,"activatedAt":555}"""
        val mode = eventMode()
        mode.start(EventMode.Target.Existing(com.onmyhop.app.core.Hop("h1", "x", "X", "open", 1, 0, 0)), me, api())
        mode.pushed("u1", "h1", since = 555, clips = 6, latest = "Ana", at = 1000)
        replies["GET /api/me/hops/h1/arrivals"] = """{"count":5,"latest":[${clip("c5", "Leo")}]}"""
        mode.poll(api())
        assertEquals(5, mode.state.value.clips)
        assertEquals(Triple("h1", 6, "Ana"), notifier.shown.last())
    }

    /** With the app closed, a push still updates the notification, and the app opens on that count. */
    @Test
    fun pushesWhileTheAppIsClosed() = runBlocking {
        replies["POST /api/me/hops/h1/activate"] = """{"ok":true,"activatedAt":555}"""
        eventMode().start(EventMode.Target.Existing(com.onmyhop.app.core.Hop("h1", "x", "X", "open", 1, 0, 0)), me, api())
        val closed = eventMode()
        closed.pushed("u1", "h1", since = 555, clips = 3, latest = "Mia", at = 1010)
        assertEquals(Triple("h1", 3, "Mia"), notifier.shown.last())
        assertNull(closed.run)

        val opened = eventMode()
        opened.resume(me)
        assertEquals(3, opened.state.value.clips)
        assertEquals(Triple("h1", 3, "Mia"), notifier.shown.last())

        // A new event starts from nothing.
        replies["POST /api/me/hops/h2/activate"] = """{"ok":true,"activatedAt":777}"""
        opened.start(EventMode.Target.Existing(com.onmyhop.app.core.Hop("h2", "y", "Y", "open", 1, 0, 0)), me, api())
        opened.pushed("u1", "h2", since = 777, clips = 1, latest = null, at = 1005)
        assertEquals(Triple("h2", 1, null), notifier.shown.last())
    }

    /** An event deleted elsewhere ends Event mode; being offline doesn't. */
    @Test
    fun endsWhenTheEventIsGone() = runBlocking {
        replies["POST /api/me/hops/h1/activate"] = """{"ok":true,"activatedAt":555}"""
        val mode = eventMode()
        mode.start(EventMode.Target.Existing(com.onmyhop.app.core.Hop("h1", "x", "X", "open", 1, 0, 0)), me, api())
        mode.poll(api()) // no arrivals reply: 404
        assertNull(mode.run)
    }
}

class RecordingNotifier : EventNotifier {
    val shown = mutableListOf<Triple<String, Int, String?>>()
    var cleared = false
    override fun show(run: EventMode.Run, clips: Int, latest: String?) {
        shown += Triple(run.hopId, clips, latest)
    }
    override fun clear() {
        cleared = true
    }
}

/** SharedPreferences in memory, for what Event mode and push notifications keep. */
class MemoryPreferences : SharedPreferences {
    private val values = mutableMapOf<String, Any?>()
    override fun getAll(): Map<String, *> = values
    override fun getString(key: String, defValue: String?) = values[key] as String? ?: defValue
    override fun getStringSet(key: String, defValues: Set<String>?) = defValues
    override fun getInt(key: String, defValue: Int) = values[key] as Int? ?: defValue
    override fun getLong(key: String, defValue: Long) = values[key] as Long? ?: defValue
    override fun getFloat(key: String, defValue: Float) = defValue
    override fun getBoolean(key: String, defValue: Boolean) = values[key] as Boolean? ?: defValue
    override fun contains(key: String) = key in values
    override fun registerOnSharedPreferenceChangeListener(listener: SharedPreferences.OnSharedPreferenceChangeListener?) = Unit
    override fun unregisterOnSharedPreferenceChangeListener(listener: SharedPreferences.OnSharedPreferenceChangeListener?) = Unit
    override fun edit(): SharedPreferences.Editor = object : SharedPreferences.Editor {
        private val changes = mutableMapOf<String, Any?>()
        private val removed = mutableSetOf<String>()
        override fun putString(key: String, value: String?) = apply { changes[key] = value }
        override fun putStringSet(key: String, values: Set<String>?) = apply { changes[key] = values }
        override fun putInt(key: String, value: Int) = apply { changes[key] = value }
        override fun putLong(key: String, value: Long) = apply { changes[key] = value }
        override fun putFloat(key: String, value: Float) = apply { changes[key] = value }
        override fun putBoolean(key: String, value: Boolean) = apply { changes[key] = value }
        override fun remove(key: String) = apply { removed += key }
        override fun clear() = apply { removed += values.keys }
        override fun commit(): Boolean {
            apply()
            return true
        }
        override fun apply() {
            removed.forEach { values.remove(it) }
            values.putAll(changes)
        }
    }
}

class CelebrationTest {
    /** Each arrival is celebrated once, however many times the stage is opened. */
    @Test
    fun celebratesEachArrivalOnce() {
        val mode = EventMode(MemoryPreferences(), RecordingNotifier())
        val first = EventMode.Arrival(id = 1, count = 1, senders = listOf("Mia"))
        assertTrue(mode.celebrate(first))
        assertFalse(mode.celebrate(first))
        assertTrue(mode.celebrate(first.copy(id = 2)))
        assertFalse(mode.celebrate(first))
    }
}
