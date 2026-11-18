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
import com.onmyhop.app.core.PlanStatus
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.launch
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

    val totalClips: Int get() = hops.sumOf { it.fileCount }

    fun hop(id: String): Hop? = hops.firstOrNull { it.id == id }
    fun clips(hopId: String): ClipList = clips[hopId] ?: ClipList()

    /** Reloads the events, the first page of every event with clips, and the plan. */
    fun refresh(activeHopId: String? = this.activeHopId, pulled: Boolean = false) {
        this.activeHopId = activeHopId
        if (pulled) isRefreshing = true
        if (hops.isEmpty()) phase = Phase.Loading
        val token = session.token
        viewModelScope.launch {
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
                isRefreshing = false
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

    private suspend fun load(hopId: String, cursor: String?, replacing: Boolean) {
        if (replacing) generations[hopId] = (generations[hopId] ?: 0) + 1
        val generation = generations[hopId] ?: 0
        clips[hopId] = clips(hopId).copy(isLoading = true)
        val query = buildMap {
            put("hopId", hopId)
            cursor?.let { put("cursor", it) }
        }
        try {
            val page = session.api.get<ClipPage>("api/me/files", query)
            if (generations[hopId] != generation) return
            val known = if (replacing) emptyList() else clips(hopId).items
            val knownIds = known.mapTo(HashSet()) { it.id }
            // A page can overlap the last if clips arrived meanwhile.
            clips[hopId] = ClipList(
                items = known + page.files.filter { it.id !in knownIds },
                nextCursor = page.nextCursor,
                loadedOnce = true,
            )
        } catch (error: CancellationException) {
            throw error
        } catch (_: Exception) {
            if (generations[hopId] != generation) return
            clips[hopId] = clips(hopId).copy(isLoading = false, failed = true)
        }
    }

    private suspend fun loadPlan() {
        val status = try {
            session.api.get<PlanStatus>("api/me/plan")
        } catch (error: CancellationException) {
            throw error
        } catch (_: Exception) {
            return
        }
        // An older reading than the one shown is stale.
        if (status.revision >= (plan?.revision ?: Long.MIN_VALUE)) plan = status
    }

    /** A short-lived link to a clip, for playing (or, with [download], saving) it. */
    suspend fun url(clip: Clip, download: Boolean = false): String {
        val query = if (download) mapOf("download" to "1") else emptyMap()
        val reply = session.api.get<ClipUrl>("api/me/files/${clip.id}/url", query)
        // Local development serves files through the API itself, by a relative path.
        return session.api.resolve(reply.url)?.toString() ?: throw IOException("bad clip link")
    }
}
