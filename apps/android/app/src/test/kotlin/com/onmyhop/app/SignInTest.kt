package com.onmyhop.app

import com.onmyhop.app.auth.Session
import com.onmyhop.app.auth.SignIn
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer
import okhttp3.OkHttpClient
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class SignInTest {
    private val server = MockWebServer()
    private val store = MemoryTokenStore()

    @Before
    fun start() = server.start()

    @After
    fun stop() = server.close()

    private fun json(body: String) =
        MockResponse.Builder().setHeader("Content-Type", "application/json").body(body).build()

    private suspend fun TestScope.started(): Pair<SignIn, Session> {
        server.enqueue(json("""{"authorizeUrl":"https://accounts.example/a?state=st4te","flow":"f","callback":{"scheme":"com.onmyhop.app"}}"""))
        val session = Session(store, server.url("/"), OkHttpClient(), backgroundScope, allowsCustomScheme = true)
        val signIn = SignIn(session, TestScope(UnconfinedTestDispatcher(testScheduler)))
        signIn.start()
        // The start request runs on OkHttp's thread; wait for the page to open.
        signIn.launches.first()
        return signIn to session
    }

    /** A stray link, or one with another flow's state, leaves the sign-in under way alone. */
    @Test
    fun ignoresRedirectsThatArentThisFlows() = runTest {
        val (signIn, session) = started()
        signIn.redirected("com.onmyhop.app", null, "/auth/callback", "other", "com.onmyhop.app:/auth/callback?state=other")
        signIn.redirected("com.onmyhop.app", "qr", null, "st4te", "com.onmyhop.app://qr?state=st4te")
        advanceUntilIdle()
        assertEquals(1, server.requestCount)
        assertEquals(SignIn.Status.Working, signIn.status.value)

        // The real redirect still finishes it.
        server.enqueue(json("""{"token":"hs_ok","expiresAt":1,"me":{"id":"u","color":"sky","emailNewClips":true}}"""))
        signIn.redirected("com.onmyhop.app", null, "/auth/callback", "st4te", "com.onmyhop.app:/auth/callback?code=c&state=st4te")
        waitFor { session.token == "hs_ok" }
        assertTrue(session.state.value.isSignedIn)
    }

    private fun waitFor(condition: () -> Boolean) {
        val until = System.currentTimeMillis() + 5_000
        while (!condition() && System.currentTimeMillis() < until) Thread.sleep(10)
    }
}
