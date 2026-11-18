package com.onmyhop.app.feature.inbox

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.onmyhop.app.auth.Session
import com.onmyhop.app.core.ApiError
import com.onmyhop.app.core.Hop
import com.onmyhop.app.core.HopsReply
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch
import java.io.IOException

/** The athlete's events, newest first, as the API lists them. */
class InboxModel(private val session: Session) : ViewModel() {
    sealed interface Phase {
        data object Loading : Phase
        data object Loaded : Phase
        data class Failed(val message: String?) : Phase
    }

    var hops: List<Hop> by mutableStateOf(emptyList())
        private set
    var phase: Phase by mutableStateOf(Phase.Loading)
        private set
    var isRefreshing by mutableStateOf(false)
        private set

    private var loading: Job? = null

    init {
        load()
    }

    val totalClips: Int get() = hops.sumOf { it.fileCount }

    /** Pull to refresh: the list stays while it reloads. */
    fun refresh() {
        isRefreshing = true
        load()
    }

    fun load() {
        loading?.cancel()
        if (hops.isEmpty()) phase = Phase.Loading
        val token = session.token
        loading = viewModelScope.launch {
            try {
                val reply = session.api.get<HopsReply>("api/me/hops")
                if (session.token == token) {
                    hops = reply.hops
                    phase = Phase.Loaded
                }
            } catch (error: ApiError) {
                phase = Phase.Failed(error.serverMessage)
            } catch (_: IOException) {
                phase = Phase.Failed(null)
            } finally {
                isRefreshing = false
            }
        }
    }
}
