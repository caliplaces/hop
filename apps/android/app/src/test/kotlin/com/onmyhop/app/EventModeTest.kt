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

/** SharedPreferences in memory, for the strings Event mode keeps. */
class MemoryPreferences : SharedPreferences {
    private val values = mutableMapOf<String, Any?>()
    override fun getAll(): Map<String, *> = values
    override fun getString(key: String, defValue: String?) = values[key] as String? ?: defValue
    override fun getStringSet(key: String, defValues: Set<String>?) = defValues
    override fun getInt(key: String, defValue: Int) = defValue
    override fun getLong(key: String, defValue: Long) = defValue
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
