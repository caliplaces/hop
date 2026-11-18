package com.onmyhop.app

import kotlinx.coroutines.CoroutineScope
import com.onmyhop.app.auth.Session
import com.onmyhop.app.core.Me
import com.onmyhop.app.feature.claim.ClaimModel
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.setMain
import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer
import okhttp3.OkHttpClient
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import java.io.IOException

@OptIn(ExperimentalCoroutinesApi::class)
class ClaimModelTest {
    private val server = MockWebServer()
    private val store = MemoryTokenStore().apply { token = "hs_abc" }

    /** While true, every request fails as if the phone were offline. */
    @Volatile private var offline = false

    @Before
    fun start() {
        Dispatchers.setMain(UnconfinedTestDispatcher())
        server.start()
    }

    @After
    fun stop() {
        server.close()
        Dispatchers.resetMain()
    }

    private fun model(): ClaimModel {
        val http = OkHttpClient.Builder()
            .addInterceptor { chain -> if (offline) throw IOException("offline") else chain.proceed(chain.request()) }
            .build()
        val session = Session(store, server.url("/"), http, CoroutineScope(Dispatchers.Unconfined), allowsCustomScheme = true)
        return ClaimModel(Me(id = "u", color = "sky", name = "Maya"), session, debounceMs = 0)
    }

    private fun json(body: String, code: Int = 200) =
        MockResponse.Builder().code(code).setHeader("Content-Type", "application/json").body(body).build()

    /** A check that couldn't reach Hop can be tried again without editing the handle. */
    @Test
    fun retriesACheckThatCouldntReachHop() {
        offline = true
        val model = model()
        waitFor { model.status != ClaimModel.Status.Checking }
        assertTrue(model.checkFailed)

        offline = false
        server.enqueue(json("""{"available":true}"""))
        model.retry()
        waitFor { model.status == ClaimModel.Status.Available }
        assertTrue(model.canClaim)
    }

    /** A claim that couldn't reach Hop says so, and leaves the button ready to try again. */
    @Test
    fun aFailedClaimCanBeTriedAgain() {
        server.enqueue(json("""{"available":true}"""))
        val model = model()
        waitFor { model.status == ClaimModel.Status.Available }

        offline = true
        model.claim()
        waitFor { !model.isClaiming }
        assertEquals(ClaimModel.Problem.Offline, model.problem)
        assertEquals(ClaimModel.Status.Available, model.status)
        assertTrue(model.canClaim)
    }

    private fun waitFor(condition: () -> Boolean) {
        val until = System.currentTimeMillis() + 5_000
        while (!condition() && System.currentTimeMillis() < until) Thread.sleep(10)
        assertTrue("timed out", condition())
    }
}
