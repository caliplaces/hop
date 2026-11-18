package com.onmyhop.app

import com.onmyhop.app.auth.Session
import com.onmyhop.app.core.Hop
import com.onmyhop.app.core.Me
import com.onmyhop.app.feature.event.EventMode
import com.onmyhop.app.push.Push
import com.onmyhop.app.push.PushMessage
import com.onmyhop.app.push.PushNotifier
import com.onmyhop.app.push.PushTokens
import com.onmyhop.app.push.Registration
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import mockwebserver3.Dispatcher
import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer
import mockwebserver3.RecordedRequest
import okhttp3.OkHttpClient
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

class PushMessageTest {
    private val registration = Registration("usr_a", "cPhone1:Fcm_example")
    private val to = registration.recipient

    /** The API's own example (apps/api/src/fcm.test.ts): both sides must agree. */
    @Test
    fun recipientMatchesTheApi() {
        assertEquals("Te1GZioAhh50qkVmoV8VSO", Registration.recipient("usr_a", "cPhone1:Fcm_example"))
    }

    @Test
    fun readsEachKind() {
        assertEquals(
            PushMessage.Clips(hopId = "hop_1", title = "2 new clips", body = "From Mia", group = "hop_1"),
            PushMessage.parse(
                mapOf("hop" to "clips", "hopId" to "hop_1", "title" to "2 new clips", "body" to "From Mia", "group" to "hop_1", "recipient" to to),
                registration,
            ),
        )
        assertEquals(
            PushMessage.Expiring(title = "3 clips leave on Friday", body = "Keep them with Hop+", tag = "expiring"),
            PushMessage.parse(
                mapOf("hop" to "expiring", "title" to "3 clips leave on Friday", "body" to "Keep them with Hop+", "tag" to "expiring", "recipient" to to),
                registration,
            ),
        )
        assertEquals(
            PushMessage.Event(hopId = "hop_1", clips = 4, latest = null, at = 99),
            PushMessage.parse(mapOf("hop" to "event", "hopId" to "hop_1", "clips" to "4", "at" to "99", "recipient" to to), registration),
        )
    }

    /** A message for anyone else (an account that signed out here, say), or that doesn't make sense, is dropped. */
    @Test
    fun dropsWhatIsntForThisAthlete() {
        val event = mapOf("hop" to "event", "hopId" to "hop_1", "clips" to "4", "at" to "99")
        assertNull(PushMessage.parse(event + ("recipient" to to), null))
        assertNull(PushMessage.parse(event, registration))
        assertNull(PushMessage.parse(event + ("recipient" to Registration.recipient("usr_b", registration.token)), registration))
        assertNull(PushMessage.parse(event + ("recipient" to Registration.recipient("usr_a", "another")), registration))
        assertNull(PushMessage.parse(event + mapOf("recipient" to to, "clips" to "-1"), registration))
        assertNull(PushMessage.parse(event + mapOf("recipient" to to, "at" to "soon"), registration))
        assertNull(PushMessage.parse(mapOf("hop" to "clips", "recipient" to to, "body" to "x"), registration))
        assertNull(PushMessage.parse(mapOf("hop" to "something", "recipient" to to), registration))
    }
}

class PushTest {
    private val server = MockWebServer()
    private val requests = mutableListOf<String>()
    /** Requests to these paths fail, as when offline. */
    private val failing = mutableSetOf<String>()
    /** While set, registering waits for it: a registration on its way. */
    private var hold: CountDownLatch? = null
    /** While set, taking a token back waits for it: a sign-out on its way. */
    private var holdDeletes: CountDownLatch? = null
    private val store = MemoryTokenStore()
    private val preferences = MemoryPreferences()
    private val eventPreferences = MemoryPreferences()
    private val tokens = FakeTokens()
    private val notifier = RecordingPushNotifier()
    private val eventNotifier = RecordingNotifier()
    private var allowed = true
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Unconfined)
    private val me = Me(id = "usr_a", color = "sky", handle = "maya")
    private lateinit var session: Session
    private lateinit var eventMode: EventMode
    private lateinit var push: Push

    @Before
    fun start() {
        server.dispatcher = object : Dispatcher() {
            override fun dispatch(request: RecordedRequest): MockResponse {
                val path = request.url.encodedPath
                if (request.method == "PUT" && path.startsWith("/api/me/devices/")) hold?.await(5, TimeUnit.SECONDS)
                if (request.method == "DELETE") holdDeletes?.await(5, TimeUnit.SECONDS)
                synchronized(requests) { requests += "${request.method} $path ${request.body?.utf8().orEmpty()}".trim() }
                if (path in failing) return MockResponse.Builder().code(500).body("""{"error":"internal_error"}""").build()
                val body = when {
                    path.endsWith("/activate") -> """{"ok":true,"activatedAt":555}"""
                    else -> """{"ok":true}"""
                }
                return MockResponse.Builder().setHeader("Content-Type", "application/json").body(body).build()
            }
        }
        server.start()
        store.token = "hs_abc"
        session = Session(store, server.url("/"), OkHttpClient(), scope)
        eventMode = EventMode(eventPreferences, eventNotifier) { 1_000_000L }
        push = push()
    }

    private fun push() = Push(session, tokens, preferences, eventMode, notifier, { allowed }, scope)

    @After
    fun stop() {
        scope.cancel()
        server.close()
    }

    private fun sent(): List<String> = synchronized(requests) { requests.toList() }

    private suspend fun waitFor(what: String, check: () -> Boolean) {
        try {
            withTimeout(5_000) { while (!check()) delay(10) }
        } catch (error: Exception) {
            throw AssertionError("$what; sent ${sent()}", error)
        }
    }

    private suspend fun signIn() {
        push.start()
        session.update(me, fromToken = "hs_abc")
        waitFor("registered") { push.registration != null }
    }

    private suspend fun startEvent() {
        eventMode.start(EventMode.Target.Existing(Hop("h1", "jam", "Jam", "open", 1, 0, 0)), me, session.api)
    }

    @Test
    fun registersForTheSignedInAthleteOncePerLaunch() = runBlocking {
        signIn()
        assertEquals(Registration("usr_a", "token-1"), push.registration)
        push.refresh().join()
        assertEquals(listOf("""PUT /api/me/devices/token-1 {"platform":"fcm"}"""), sent())
        // FCM gave a new token: registered again, at once.
        tokens.token = "token-2"
        push.tokenChanged().join()
        assertEquals("""PUT /api/me/devices/token-2 {"platform":"fcm"}""", sent().last())
        assertEquals(Registration("usr_a", "token-2"), push.registration)
    }

    @Test
    fun waitsUntilNotificationsAreAllowed() = runBlocking {
        allowed = false
        push.start()
        session.update(me, fromToken = "hs_abc")
        push.refresh().join()
        assertEquals(emptyList<String>(), sent())
        assertNull(push.registration)
        allowed = true
        push.refresh().join()
        assertEquals(Registration("usr_a", "token-1"), push.registration)
    }

    @Test
    fun triesAgainWhenTheApiOrFcmCantBeReached() = runBlocking {
        failing += "/api/me/devices/token-1"
        push.start()
        session.update(me, fromToken = "hs_abc")
        push.refresh().join()
        assertNull(push.registration)
        failing.clear()
        tokens.failing = true
        push.refresh().join()
        assertNull(push.registration)
        tokens.failing = false
        push.refresh().join()
        assertEquals(Registration("usr_a", "token-1"), push.registration)
    }

    /** Signing out takes the token back from the API (and Event mode's updates), then from FCM, before the session ends. */
    @Test
    fun signingOutTakesTheTokenBack() = runBlocking {
        signIn()
        startEvent()
        waitFor("watching the event") { sent().any { it.startsWith("PUT /api/me/live-activities/") } }
        assertEquals("""PUT /api/me/live-activities/token-1 {"hopId":"h1","since":555,"platform":"fcm"}""", sent().last())

        session.signOut().join()
        assertEquals(
            listOf("DELETE /api/me/live-activities/token-1", "DELETE /api/me/devices/token-1", "POST /api/auth/logout"),
            sent().takeLast(3),
        )
        assertNull(push.registration)
        assertEquals(1, tokens.deleted)
    }

    /** Signed out by the server: nothing to tell it, but FCM drops the token, so the API forgets it at the next push. */
    @Test
    fun aSessionThatEndedStillDropsTheToken() = runBlocking {
        signIn()
        val before = sent().size
        push.signedOut(null)
        assertEquals(before, sent().size)
        assertNull(push.registration)
        assertEquals(1, tokens.deleted)
    }

    /** A sign-out waits for a registration on its way, then takes it back. */
    @Test
    fun signingOutWaitsForARegistrationOnItsWay() = runBlocking {
        hold = CountDownLatch(1)
        push.start()
        session.update(me, fromToken = "hs_abc")
        val registering = push.refresh()
        val signingOut = session.signOut()
        hold?.countDown()
        registering.join()
        signingOut.join()
        assertEquals(
            listOf("""PUT /api/me/devices/token-1 {"platform":"fcm"}""", "DELETE /api/me/devices/token-1", "POST /api/auth/logout"),
            sent(),
        )
        assertNull(push.registration)
        assertEquals(1, tokens.deleted)
    }

    @Test
    fun followsEventModeWhileItRuns() = runBlocking {
        // Already running when the phone registers.
        startEvent()
        signIn()
        waitFor("watching the event") { sent().any { it.startsWith("PUT /api/me/live-activities/token-1") } }
        eventMode.end()
        waitFor("stopped watching") { sent().last() == "DELETE /api/me/live-activities/token-1" }
    }

    @Test
    fun showsWhatsForTheAthleteSignedInHere() = runBlocking {
        signIn()
        val to = push.registration!!.recipient
        push.received(mapOf("hop" to "clips", "hopId" to "h1", "title" to "New clip", "body" to "Mia sent a clip", "recipient" to to))
        push.received(mapOf("hop" to "clips", "title" to "New clip", "body" to "Mia sent a clip", "recipient" to "someone-else"))
        assertEquals(listOf("New clip"), notifier.clips.map { it.title })
        assertEquals(1, push.arrivals.value)
        push.received(mapOf("hop" to "expiring", "title" to "Clips leave soon", "body" to "x", "recipient" to to))
        assertEquals(1, notifier.expiring.size)

        startEvent()
        push.received(mapOf("hop" to "event", "hopId" to "h1", "clips" to "3", "latest" to "Mia", "at" to "10", "recipient" to to))
        assertEquals(Triple("h1", 3, "Mia"), eventNotifier.shown.last())
    }

    /** Nothing shows while a sign-out is still taking the token back, and what was showing goes at once. */
    @Test
    fun signingOutShowsNothingMore() = runBlocking {
        signIn()
        val to = push.registration!!.recipient
        holdDeletes = CountDownLatch(1)
        val signingOut = session.signOut()
        assertTrue(notifier.cleared)
        push.received(mapOf("hop" to "clips", "title" to "New clip", "body" to "x", "recipient" to to))
        assertTrue(notifier.clips.isEmpty())
        holdDeletes?.countDown()
        signingOut.join()
    }

    /** Someone else signed in before their own registration replaced the last one: its messages aren't theirs. */
    @Test
    fun anotherAthleteSeesNothingOfTheLast() = runBlocking {
        signIn()
        val to = push.registration!!.recipient
        allowed = false // so the new athlete's registration doesn't replace it
        session.update(me.copy(id = "usr_b"), fromToken = "hs_abc")
        push.received(mapOf("hop" to "clips", "title" to "New clip", "body" to "x", "recipient" to to))
        assertTrue(notifier.clips.isEmpty())
    }

    /** The app was closed in the middle of signing out: the next launch finishes it. */
    @Test
    fun finishesASignOutCutShort() = runBlocking {
        signIn()
        // Signed out here, but the rest never ran.
        session.onSignOut = {}
        session.signOut().join()
        assertTrue(push.registration != null)
        val relaunched = push()
        relaunched.start()
        waitFor("finished") { relaunched.registration == null && tokens.deleted == 1 }
    }

    /** A token FCM gave is deleted even when the API's reply about it never came back. */
    @Test
    fun deletesATokenTheApiNeverConfirmed() = runBlocking {
        failing += "/api/me/devices/token-1"
        push.start()
        session.update(me, fromToken = "hs_abc")
        push.refresh().join()
        assertNull(push.registration)
        session.signOut().join()
        assertEquals(1, tokens.deleted)
    }

    /** Deleting the token offline is tried again at each launch until it works. */
    @Test
    fun keepsTryingToDeleteTheToken() = runBlocking {
        signIn()
        tokens.deleteFailing = true
        session.signOut().join()
        assertEquals(0, tokens.deleted)
        tokens.deleteFailing = false
        val relaunched = push()
        relaunched.start()
        waitFor("deleted") { tokens.deleted == 1 }
        // Done: the launch after doesn't again.
        push().start()
        assertEquals(1, tokens.deleted)
    }

    @Test
    fun signedOutPhonesShowNothing() = runBlocking {
        signIn()
        val to = push.registration!!.recipient
        push.signedOut(null)
        push.received(mapOf("hop" to "clips", "title" to "New clip", "body" to "x", "recipient" to to))
        assertTrue(notifier.clips.isEmpty())
        assertFalse(push.arrivals.value > 0)
    }

    private class FakeTokens : PushTokens {
        var token = "token-1"
        var failing = false
        var deleteFailing = false
        var deleted = 0
        override suspend fun token(): String {
            if (failing) error("FCM can't be reached")
            return token
        }
        override suspend fun delete() {
            if (deleteFailing) error("offline")
            deleted++
        }
    }

    private class RecordingPushNotifier : PushNotifier {
        val clips = mutableListOf<PushMessage.Clips>()
        val expiring = mutableListOf<PushMessage.Expiring>()
        var cleared = false
        override fun clips(message: PushMessage.Clips) {
            clips += message
        }
        override fun expiring(message: PushMessage.Expiring) {
            expiring += message
        }
        override fun clear() {
            cleared = true
        }
    }
}
