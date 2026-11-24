package com.onmyhop.app.feature.inbox

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.onmyhop.app.auth.Session
import com.onmyhop.app.core.ApiError
import com.onmyhop.app.core.Clip
import com.onmyhop.app.core.ClipPage
import com.onmyhop.app.core.ClipUrl
import com.onmyhop.app.core.Hop
import com.onmyhop.app.core.HopsReply
import com.onmyhop.app.core.Empty
import com.onmyhop.app.core.Ok
import com.onmyhop.app.core.PlanStatus
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.isActive
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.launch
import kotlinx.serialization.Serializable
import java.io.IOException

/**
 * The athlete's events and the clips in each, loaded a page at a time, and
 * their plan, for the nudges. One for the signed-in app: the inbox, an
 * event's grid and the viewer all read the same lists.
 */
class InboxModel(private val session: Session) : ViewModel() {
    sealed interface Phase {
        data object Loading : Phase
        data object Loaded : Phase

        /** The server's words, or null when it couldn't be reached. */
        data class Failed(val message: String?) : Phase
    }

    /** The clips loaded so far for one event. */
    data class ClipList(
        val items: List<Clip> = emptyList(),
        val nextCursor: String? = null,
        val loadedOnce: Boolean = false,
        val isLoading: Boolean = false,
        val failed: Boolean = false,
    ) {
        val hasMore: Boolean get() = !loadedOnce || nextCursor != null
    }

    var hops: List<Hop> by mutableStateOf(emptyList())
        private set
    var phase: Phase by mutableStateOf(Phase.Loading)
        private set
    var isRefreshing by mutableStateOf(false)
        private set
    var plan: PlanStatus? by mutableStateOf(null)
        private set

    /** Each event's clips, by event id. */
    val clips = mutableStateMapOf<String, ClipList>()

    /** Bumped each time an event's list starts over, so an older page can't land on the new one. */
    private val generations = mutableMapOf<String, Int>()

    /** The event the athlete's link uploads to, which comes first. */
    private var activeHopId: String? = null

    /** The refresh under way. A newer one replaces it, so an older reply can't land last. */
    private var refreshing: Job? = null

    /**
     * Clips known to be gone (deleted, or a blocked sender's): kept out of any
     * page that arrives later, including one requested before they went.
     */
    private val dropped = mutableSetOf<String>()

    val totalClips: Int get() = hops.sumOf { it.fileCount }

    fun hop(id: String): Hop? = hops.firstOrNull { it.id == id }
    fun clips(hopId: String): ClipList = clips[hopId] ?: ClipList()

    /** Reloads the events, the first page of every event with clips, and the plan. */
    fun refresh(activeHopId: String? = this.activeHopId, pulled: Boolean = false) {
        this.activeHopId = activeHopId
        if (pulled) isRefreshing = true
        if (hops.isEmpty()) phase = Phase.Loading
        val token = session.token
        refreshing?.cancel()
        refreshing = viewModelScope.launch {
            try {
                coroutineScope {
                    val planLoad = async { loadPlan() }
                    val reply = session.api.get<HopsReply>("api/me/hops")
                    if (session.token != token) return@coroutineScope
                    // The event the link uploads to comes first, then newest first.
                    hops = reply.hops.sortedWith(
                        compareByDescending<Hop> { it.id == activeHopId }.thenByDescending { it.createdAt },
                    )
                    phase = Phase.Loaded
                    clips.keys.retainAll(hops.map { it.id }.toSet())
                    hops.filter { clips[it.id]?.loadedOnce == true || it.fileCount > 0 }
                        .map { async { load(it.id, cursor = null, replacing = true) } }
                        .awaitAll()
                    planLoad.await()
                }
            } catch (error: CancellationException) {
                throw error
            } catch (error: Exception) {
                if (hops.isEmpty()) phase = Phase.Failed((error as? ApiError)?.serverMessage)
            } finally {
                // A refresh that a newer one replaced leaves the spinner to it.
                if (currentCoroutineContext().isActive) isRefreshing = false
            }
        }
    }

    /** The next page of an event's clips, if there is one. */
    fun loadMore(hopId: String) {
        val list = clips(hopId)
        if (!list.hasMore || list.isLoading) return
        viewModelScope.launch { load(hopId, list.nextCursor, replacing = false) }
    }

    /** The next page once [clipId] is among the last few loaded, so swiping on never runs out. */
    fun loadMoreNear(hopId: String, clipId: String) {
        val items = clips(hopId).items
        val index = items.indexOfFirst { it.id == clipId }
        if (index >= 0 && index >= items.size - 3) loadMore(hopId)
    }

    private fun generation(hopId: String): Int = generations[hopId] ?: 0

    private suspend fun load(hopId: String, cursor: String?, replacing: Boolean) {
        if (replacing) generations[hopId] = generation(hopId) + 1
        val generation = generation(hopId)
        clips[hopId] = clips(hopId).copy(isLoading = true)
        val query = buildMap {
            put("hopId", hopId)
            cursor?.let { put("cursor", it) }
        }
        try {
            val page = session.api.get<ClipPage>("api/me/files", query)
            if (generation(hopId) != generation) return
            val fresh = page.files.filter { it.id !in dropped }
            clips[hopId] = if (replacing) {
                refreshed(clips(hopId), fresh, page.nextCursor)
            } else {
                val known = clips(hopId).items
                val knownIds = known.mapTo(HashSet()) { it.id }
                // A page can overlap the last if clips arrived meanwhile.
                ClipList(items = known + fresh.filter { it.id !in knownIds }, nextCursor = page.nextCursor, loadedOnce = true)
            }
        } catch (error: CancellationException) {
            // A newer refresh replaced this one: no longer loading, unless a newer load already is.
            if (generation(hopId) == generation) clips[hopId] = clips(hopId).copy(isLoading = false)
            throw error
        } catch (_: Exception) {
            if (generation(hopId) != generation) return
            clips[hopId] = clips(hopId).copy(isLoading = false, failed = true)
        }
    }

    /**
     * A refresh's first page, then whatever was loaded past it before. A
     * refresh comes with every push and Event mode count, so a clip open in
     * the viewer, or further down the grid, stays where it was.
     */
    private fun refreshed(previous: ClipList, first: List<Clip>, nextCursor: String?): ClipList {
        val last = first.lastOrNull()
        // The whole event fits on the first page: nothing older is left to keep.
        if (nextCursor == null || last == null) return ClipList(first, nextCursor, loadedOnce = true)
        val ids = first.mapTo(HashSet()) { it.id }
        // Pages run newest first, by when the clip arrived and then its id, as the API sorts them.
        val older = previous.items.filter {
            it.id !in ids && it.id !in dropped &&
                (it.createdAt < last.createdAt || (it.createdAt == last.createdAt && it.id < last.id))
        }
        return ClipList(
            items = first + older,
            // Carrying on from where the list had got to.
            nextCursor = if (older.isEmpty()) nextCursor else previous.nextCursor,
            loadedOnce = true,
        )
    }

    /** Reloads the plan alone, as when the account opens. */
    fun refreshPlan() {
        viewModelScope.launch { loadPlan() }
    }

    /** Plan requests in the order they were made, and the newest one shown. */
    private var planAsked = 0
    private var planShown = 0

    private suspend fun loadPlan() {
        val asked = ++planAsked
        val status = try {
            session.api.get<PlanStatus>("api/me/plan")
        } catch (error: CancellationException) {
            throw error
        } catch (_: Exception) {
            return
        }
        // Stale: asked before the reading shown (storage moves with every delete), or
        // read before a subscription change the one shown already reflects.
        if (asked < planShown || status.revision < (plan?.revision ?: Long.MIN_VALUE)) return
        plan = status
        planShown = asked
    }

    /** Deletes a clip for good, and takes it out of its event's list and totals. */
    suspend fun delete(clip: Clip) = owned {
        session.api.delete("api/me/files/${clip.id}")
        drop(mapOf(clip.id to clip))
        // A refresh under way may have read the totals from before: it starts
        // over. Otherwise the plan alone (storage, clips about to leave) moves.
        if (refreshing?.isActive == true) refresh() else loadPlan()
    }

    /** Reports a clip to Hop's team. */
    suspend fun report(clip: Clip, reason: ReportReason, note: String?) = owned {
        session.api.post<ReportRequest, Ok>("api/me/files/${clip.id}/report", ReportRequest(reason.id, note?.trim()?.ifEmpty { null }))
    }

    /**
     * Blocks whoever sent a clip: their clips leave the inbox (dropped here at
     * once, then a fresh reload), and they can't send more. Returns the ids
     * of the clips that went.
     */
    suspend fun block(clip: Clip): Set<String> = owned {
        val reply = session.api.post<Empty, BlockReply>("api/me/files/${clip.id}/block", Empty)
        val known = clips.values.flatMap { it.items }.associateBy { it.id }
        drop(reply.removedIds.associateWith { known[it] } + (clip.id to clip))
        refresh()
        reply.removedIds.toSet() + clip.id
    }

    /**
     * Runs a change in the inbox's own scope: once it's asked for, leaving the
     * screen that asked (which cancels the wait) can't stop the request or
     * the lists catching up with it.
     */
    private suspend fun <T> owned(change: suspend () -> T): T = viewModelScope.async { change() }.await()

    /**
     * Takes clips that are gone out of every event's list and totals, without
     * waiting for a reload. Clips this hasn't loaded only stay out of later pages.
     */
    private fun drop(gone: Map<String, Clip?>) {
        dropped += gone.keys
        for ((hopId, list) in clips.toMap()) {
            if (list.items.none { it.id in gone }) continue
            clips[hopId] = list.copy(items = list.items.filterNot { it.id in gone })
        }
        val byHop = gone.values.filterNotNull().groupBy { it.hopId }
        hops = hops.map { hop ->
            val removed = byHop[hop.id] ?: return@map hop
            hop.copy(
                fileCount = (hop.fileCount - removed.size).coerceAtLeast(0),
                totalBytes = (hop.totalBytes - removed.sumOf { it.size }).coerceAtLeast(0),
            )
        }
    }

    @Serializable
    private class ReportRequest(val reason: String, val note: String? = null)

    @Serializable
    private class BlockReply(val removedIds: List<String> = emptyList())

    /** A short-lived link to a clip, for playing (or, with [download], saving) it. */
    suspend fun url(clip: Clip, download: Boolean = false): String {
        val query = if (download) mapOf("download" to "1") else emptyMap()
        val reply = session.api.get<ClipUrl>("api/me/files/${clip.id}/url", query)
        // Local development serves files through the API itself, by a relative path.
        return session.api.resolve(reply.url)?.toString() ?: throw IOException("bad clip link")
    }
}
