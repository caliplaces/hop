package com.onmyhop.app

import com.onmyhop.app.auth.Session
import com.onmyhop.app.feature.inbox.InboxModel
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.setMain
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

@OptIn(ExperimentalCoroutinesApi::class)
class InboxModelTest {
    private val server = MockWebServer()

    /** Replies by path, so requests made side by side get the right one. */
    private val replies = mutableMapOf<String, String>()

    /** Replies by path for the first request only, and how long to hold them back. */
    private val firstReplies = mutableMapOf<String, Pair<String, Long>>()

    @Before
    fun start() {
        Dispatchers.setMain(UnconfinedTestDispatcher())
        server.dispatcher = object : Dispatcher() {
            override fun dispatch(request: RecordedRequest): MockResponse {
                val key = request.url.encodedPath + (request.url.encodedQuery?.let { "?$it" } ?: "")
                firstReplies.remove(key)?.let { (body, delay) ->
                    Thread.sleep(delay)
                    return MockResponse.Builder().setHeader("Content-Type", "application/json").body(body).build()
                }
                val body = replies[key] ?: replies[request.url.encodedPath] ?: return MockResponse.Builder().code(404).body("""{"error":"not_found"}""").build()
                return MockResponse.Builder().setHeader("Content-Type", "application/json").body(body).build()
            }
        }
        server.start()
    }

    @After
    fun stop() {
        server.close()
        Dispatchers.resetMain()
    }

    private fun model(): InboxModel {
        val store = MemoryTokenStore().apply { token = "hs_abc" }
        val session = Session(store, server.url("/"), OkHttpClient(), CoroutineScope(Dispatchers.Unconfined), allowsCustomScheme = true)
        return InboxModel(session)
    }

    private fun hop(id: String, createdAt: Long, files: Int) =
        """{"id":"$id","slug":"$id","title":"Event $id","status":"open","createdAt":$createdAt,"fileCount":$files,"totalBytes":${files * 1000}}"""

    private fun clip(id: String, hopId: String, createdAt: Long) =
        """{"id":"$id","hopId":"$hopId","name":"$id.mp4","mime":"video/mp4","size":1000,"hasThumbnail":true,"contributorName":"Mia","contributorVerified":false,"note":null,"createdAt":$createdAt}"""

    /** The event the link uploads to comes first, then the newest. */
    @Test
    fun putsTheLiveEventFirstThenNewest() {
        replies["/api/me/hops"] = """{"hops":[${hop("old", 1, 0)},${hop("new", 3, 0)},${hop("live", 2, 0)}]}"""
        replies["/api/me/plan"] = """{"plan":"free","storage":{"usedBytes":1,"limitBytes":10},"revision":1}"""
        val model = model()
        model.refresh(activeHopId = "live")
        waitFor { model.phase == InboxModel.Phase.Loaded }
        assertEquals(listOf("live", "new", "old"), model.hops.map { it.id })
    }

    /** Covers load with the events; more pages follow on, without repeating clips that overlap. */
    @Test
    fun pagesThroughAnEventsClips() {
        replies["/api/me/hops"] = """{"hops":[${hop("h", 1, 3)}]}"""
        replies["/api/me/plan"] = """{"plan":"free","storage":{"usedBytes":1,"limitBytes":10},"revision":1}"""
        replies["/api/me/files?hopId=h"] = """{"files":[${clip("c3", "h", 3)},${clip("c2", "h", 2)}],"nextCursor":"2:c2"}"""
        // A clip arrived meanwhile, so the next page starts with one already shown.
        replies["/api/me/files?hopId=h&cursor=2%3Ac2"] = """{"files":[${clip("c2", "h", 2)},${clip("c1", "h", 1)}],"nextCursor":null}"""
        val model = model()
        model.refresh()
        waitFor { model.clips("h").loadedOnce }
        assertEquals(listOf("c3", "c2"), model.clips("h").items.map { it.id })
        assertTrue(model.clips("h").hasMore)

        model.loadMoreNear("h", "c2")
        waitFor { model.clips("h").items.size == 3 }
        assertEquals(listOf("c3", "c2", "c1"), model.clips("h").items.map { it.id })
        assertFalse(model.clips("h").hasMore)
    }

    /** Events with nothing in them aren't asked for clips; the plan comes with the events. */
    @Test
    fun skipsEmptyEventsAndLoadsThePlan() {
        replies["/api/me/hops"] = """{"hops":[${hop("empty", 1, 0)}]}"""
        replies["/api/me/plan"] = """{"plan":"free","storage":{"usedBytes":9,"limitBytes":10},"expiring":{"clips":2,"on":"2026-12-01","at":1},"revision":4}"""
        val model = model()
        model.refresh()
        waitFor { model.plan != null }
        assertFalse(model.clips("empty").loadedOnce)
        assertTrue(model.plan!!.isNearlyFull)
        assertEquals(2, model.plan!!.expiring?.clips)
        assertEquals(0, server.requestCount - 2)
    }

    /** An event the refresh skipped (empty when listed) still loads when it's opened. */
    @Test
    fun opensAnEventTheRefreshSkipped() {
        replies["/api/me/hops"] = """{"hops":[${hop("h", 1, 0)}]}"""
        replies["/api/me/plan"] = """{"plan":"free","storage":{"usedBytes":1,"limitBytes":10},"revision":1}"""
        // A clip arrived after the list was loaded.
        replies["/api/me/files?hopId=h"] = """{"files":[${clip("c1", "h", 1)}],"nextCursor":null}"""
        val model = model()
        model.refresh()
        waitFor { model.phase == InboxModel.Phase.Loaded }
        model.loadMore("h")
        waitFor { model.clips("h").loadedOnce }
        assertEquals(listOf("c1"), model.clips("h").items.map { it.id })
        assertFalse(model.clips("h").isLoading)
    }

    /** A refresh that started earlier but answers last doesn't replace the newer one's events. */
    @Test
    fun aNewerRefreshWins() {
        firstReplies["/api/me/hops"] = """{"hops":[${hop("old", 1, 0)}]}""" to 400L
        replies["/api/me/hops"] = """{"hops":[${hop("old", 1, 0)},${hop("live", 2, 0)}]}"""
        replies["/api/me/plan"] = """{"plan":"free","storage":{"usedBytes":1,"limitBytes":10},"revision":1}"""
        val model = model()
        model.refresh(activeHopId = null)
        Thread.sleep(50)
        model.refresh(activeHopId = "live")
        waitFor { model.phase == InboxModel.Phase.Loaded }
        Thread.sleep(600)
        assertEquals(listOf("live", "old"), model.hops.map { it.id })
        assertFalse(model.isRefreshing)
    }

    /** Offline before anything loaded: the inbox says so; with events shown, they stay. */
    @Test
    fun failsOnlyWhenThereIsNothingToShow() {
        val model = model()
        model.refresh()
        waitFor { model.phase is InboxModel.Phase.Failed }
        assertNull(model.plan)
    }

    private fun waitFor(condition: () -> Boolean) {
        val until = System.currentTimeMillis() + 5_000
        while (!condition() && System.currentTimeMillis() < until) Thread.sleep(10)
        assertTrue("timed out", condition())
    }
}
