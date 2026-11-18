package com.onmyhop.app

import com.onmyhop.app.auth.Session
import com.onmyhop.app.auth.SignInCallback
import com.onmyhop.app.auth.TokenStore
import com.onmyhop.app.core.ApiError
import com.onmyhop.app.core.Me
import kotlinx.coroutines.test.runTest
import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.OkHttpClient
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Before
import org.junit.Test

class SessionTest {
    private val server = MockWebServer()
    private val store = MemoryTokenStore()

    @Before
    fun start() = server.start()

    @After
    fun stop() = server.close()

    private fun session(allowsCustomScheme: Boolean = true) =
        Session(store, server.url("/"), OkHttpClient(), allowsCustomScheme)

    private fun json(body: String, code: Int = 200) =
        MockResponse.Builder().code(code).setHeader("Content-Type", "application/json").body(body).build()

    private val meJson = """{"id":"u1","name":"Maya","email":null,"handle":"maya","activeHopId":null,"color":"sky","emailNewClips":true}"""

    @Test
    fun signsInThroughTheApi() = runTest {
        server.enqueue(json("""{"authorizeUrl":"https://accounts.example/authorize?x=1","flow":"signed","callback":{"scheme":"com.onmyhop.app"}}"""))
        server.enqueue(json("""{"token":"hs_abc","expiresAt":1,"me":$meJson}"""))
        val session = session()

        val started = session.startSignIn()
        assertEquals(SignInCallback.CustomScheme, started.callback)
        session.finishSignIn(started, "com.onmyhop.app:/auth/callback?code=c&state=s")

        assertEquals("hs_abc", store.token)
        assertEquals("maya", session.me?.handle)
        assertEquals("POST", server.takeRequest().method)
        val finish = server.takeRequest()
        assertEquals("/api/auth/app/session", finish.url.encodedPath)
        assertTrue(finish.body!!.utf8().contains(""""callbackUrl":"com.onmyhop.app:/auth/callback?code=c&state=s""""))
        assertTrue(finish.headers["Content-Type"]!!.startsWith("application/json"))
    }

    /** Older servers don't say where the redirect goes: the custom scheme. */
    @Test
    fun olderServersUseTheScheme() = runTest {
        server.enqueue(json("""{"authorizeUrl":"https://accounts.example/authorize","flow":"f"}"""))
        assertEquals(SignInCallback.CustomScheme, session().startSignIn().callback)
    }

    /** Only callbacks Hop alone can catch: never another app's scheme or another site's page. */
    @Test
    fun refusesCallbacksThatArentHops() = runTest {
        for (callback in listOf("""{"scheme":"com.evil.app"}""", """{"host":"evil.example","path":"/api/auth/app/callback"}""")) {
            server.enqueue(json("""{"authorizeUrl":"https://accounts.example/a","flow":"f","callback":$callback}"""))
            try {
                session().startSignIn()
                fail("accepted $callback")
            } catch (error: ApiError) {
                assertEquals("untrusted_callback", error.code)
            }
        }
    }

    @Test
    fun refusesAPlainHttpSignInPage() = runTest {
        server.enqueue(json("""{"authorizeUrl":"http://accounts.example/a","flow":"f"}"""))
        try {
            session().startSignIn()
            fail("accepted http")
        } catch (error: ApiError) {
            assertEquals("bad_authorize_url", error.code)
        }
    }

    /** Release builds talk to production, which only signs in through the https callback. */
    @Test
    fun releaseBuildsRefuseTheCustomScheme() = runTest {
        server.enqueue(json("""{"authorizeUrl":"https://accounts.example/a","flow":"f","callback":{"scheme":"com.onmyhop.app"}}"""))
        try {
            session(allowsCustomScheme = false).startSignIn()
            fail("accepted the custom scheme")
        } catch (error: ApiError) {
            assertEquals("untrusted_callback", error.code)
        }
    }

    @Test
    fun theApisOwnHttpsCallbackIsTrusted() {
        val base = "https://onmyhop.com".toHttpUrl()
        val https = SignInCallback.Https("onmyhop.com", "/api/auth/app/callback")
        assertTrue(https.isTrusted(base, allowsScheme = false))
        assertFalse(SignInCallback.Https("onmyhop.com", "/elsewhere").isTrusted(base, allowsScheme = true))
        assertFalse(https.isTrusted("http://onmyhop.com".toHttpUrl(), allowsScheme = true))
        assertTrue(https.matches("https", "onmyhop.com", "/api/auth/app/callback"))
        assertFalse(https.matches("http", "onmyhop.com", "/api/auth/app/callback"))
    }

    /** Only com.onmyhop.app:/auth/callback, exactly, is the scheme's callback. */
    @Test
    fun theSchemeCallbackMatchesExactly() {
        val scheme = SignInCallback.CustomScheme
        assertTrue(scheme.matches("com.onmyhop.app", null, "/auth/callback"))
        assertFalse(scheme.matches("com.evil.app", null, "/auth/callback"))
        assertFalse(scheme.matches("com.onmyhop.app", "qr", null))
        assertFalse(scheme.matches("com.onmyhop.app", null, "/elsewhere"))
    }

    /** Tokens and PKCE verifiers never end up in logs or crash reports through toString. */
    @Test
    fun neverPrintsSecrets() {
        store.token = "hs_secret"
        val session = session()
        assertFalse(session.state.value.toString().contains("hs_secret"))
        val started = Session.Started("https://a.example/x?state=s".toHttpUrl(), "flow-secret", SignInCallback.CustomScheme)
        assertFalse(started.toString().contains("flow-secret"))
        assertEquals("s", started.state)
    }

    @Test
    fun refreshSendsTheTokenAndLoadsTheProfile() = runTest {
        store.token = "hs_abc"
        server.enqueue(json("""{"me":$meJson}"""))
        val session = session()
        session.refresh()
        assertEquals("Maya", session.me?.name)
        assertEquals("Bearer hs_abc", server.takeRequest().headers["Authorization"])
    }

    /** A session the server no longer knows signs out here. */
    @Test
    fun refreshForgetsAnEndedSession() = runTest {
        store.token = "hs_abc"
        server.enqueue(json("""{"me":null}"""))
        val session = session()
        session.refresh()
        assertFalse(session.state.value.isSignedIn)
        assertNull(store.token)
    }

    /** Offline, or the server failing, keeps the session for next time. */
    @Test
    fun refreshKeepsTheSessionWhenItCantAsk() = runTest {
        store.token = "hs_abc"
        server.enqueue(json("""{"error":"internal_error"}""", code = 500))
        val session = session()
        session.refresh()
        assertTrue(session.state.value.isSignedIn)
        assertEquals("hs_abc", store.token)
    }

    /** A reply for a session that has since changed is dropped. */
    @Test
    fun updatesOnlyFromTheCurrentSession() {
        store.token = "hs_new"
        val session = session()
        session.update(Me(id = "u1", color = "sky", handle = "old"), fromToken = "hs_old")
        assertNull(session.me)
        session.update(Me(id = "u1", color = "sky", handle = "new"), fromToken = "hs_new")
        assertEquals("new", session.me?.handle)
    }

    @Test
    fun signsOutHereFirstThenOnTheServer() = runTest {
        store.token = "hs_abc"
        server.enqueue(json("""{"ok":true}"""))
        val session = session()
        var before: String? = null
        session.signOut { before = it.token }
        assertFalse(session.state.value.isSignedIn)
        assertNull(store.token)
        assertEquals("hs_abc", before)
        val logout = server.takeRequest()
        assertEquals("/api/auth/logout", logout.url.encodedPath)
        assertEquals("Bearer hs_abc", logout.headers["Authorization"])
    }

    /** Deleting an account whose session is already gone (a retry, say) still forgets it. */
    @Test
    fun deletingAnAlreadyEndedSessionForgetsIt() = runTest {
        store.token = "hs_abc"
        server.enqueue(json("""{"error":"unauthorized"}""", code = 401))
        val session = session()
        session.deleteAccount()
        assertFalse(session.state.value.isSignedIn)
    }

    @Test
    fun deletingKeepsTheSessionUnlessTheServerConfirms() = runTest {
        store.token = "hs_abc"
        server.enqueue(json("""{"error":"internal_error","message":"Something went wrong on our side."}""", code = 500))
        val session = session()
        try {
            session.deleteAccount()
            fail("deleted without the server")
        } catch (error: ApiError) {
            assertEquals("Something went wrong on our side.", error.message)
        }
        assertTrue(session.state.value.isSignedIn)
    }
}

class MemoryTokenStore : TokenStore {
    var token: String? = null
    override fun read() = token
    override fun write(token: String) {
        this.token = token
    }
    override fun delete() {
        token = null
    }
}
