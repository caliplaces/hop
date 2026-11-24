package com.onmyhop.app.auth

import android.net.Uri
import com.onmyhop.app.core.ApiError
import com.onmyhop.app.core.HopJson
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.receiveAsFlow
import kotlinx.coroutines.launch
import kotlinx.serialization.Serializable
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import java.io.IOException

/**
 * Signing in, across the app and the browser. It outlives any one activity:
 * Android may recreate the activity while Caliplaces' page is showing, and
 * the redirect can come back through the Auth Tab's result or, in browsers
 * without Auth Tabs, through SignInCallbackActivity. Android may even stop
 * the app meanwhile, so the flow waiting for its redirect is also kept in
 * [saved] until the API would have forgotten it.
 */
class SignIn(
    private val session: Session,
    private val scope: CoroutineScope,
    /**
     * The flow waiting for its redirect, kept encrypted (it holds the PKCE
     * verifier) for a new process to finish. Null keeps it in memory only.
     */
    private val saved: TokenStore? = null,
    private val now: () -> Long = System::currentTimeMillis,
) {
    sealed interface Status {
        data object Idle : Status
        data object Working : Status
        data class Failed(val message: String) : Status
    }

    private val _status = MutableStateFlow<Status>(Status.Idle)
    val status: StateFlow<Status> = _status.asStateFlow()

    /** Pages the activity should open, in an Auth Tab. */
    private val _launches = Channel<Session.Started>(Channel.CONFLATED)
    val launches = _launches.receiveAsFlow()

    /** The flow waiting for its redirect. A newer start replaces it. */
    private var pending: Session.Started? = null

    fun start() {
        if (_status.value == Status.Working) return
        _status.value = Status.Working
        scope.launch {
            try {
                val started = session.startSignIn()
                pending = started
                save(started)
                _launches.send(started)
            } catch (error: Exception) {
                _status.value = Status.Failed(describe(error))
            }
        }
    }

    /**
     * The browser came back with this URL. Only the flow's own callback, with
     * its own state, finishes it; anything else is ignored, so a stray link
     * can't cut a sign-in short.
     */
    fun redirected(uri: Uri) {
        // Anything can send one (the callback activity is exported), and an
        // opaque URI has no query to read: it's no callback of ours.
        if (!uri.isHierarchical) return
        redirected(uri.scheme, uri.host, uri.path, uri.getQueryParameter("state"), uri.toString())
    }

    internal fun redirected(scheme: String?, host: String?, path: String?, state: String?, url: String) {
        val started = pending ?: restore() ?: return
        if (!started.callback.matches(scheme, host, path)) return
        if (started.state != null && state != started.state) return
        pending = null
        forget()
        _status.value = Status.Working
        scope.launch {
            try {
                session.finishSignIn(started, url)
                _status.value = Status.Idle
            } catch (error: Exception) {
                _status.value = Status.Failed(describe(error))
            }
        }
    }

    /**
     * The page was closed without signing in. The flow stays, in case its
     * redirect is still on the way from a browser without Auth Tabs.
     */
    fun cancelled() {
        if (_status.value == Status.Working && pending != null) _status.value = Status.Idle
    }

    fun failed(message: String) {
        pending = null
        forget()
        _status.value = Status.Failed(message)
    }

    private fun save(started: Session.Started) {
        val store = saved ?: return
        val callback = started.callback
        val flow = SavedFlow(
            authorizeUrl = started.authorizeUrl.toString(),
            flow = started.flow,
            scheme = (callback as? SignInCallback.Scheme)?.scheme,
            host = (callback as? SignInCallback.Https)?.host,
            path = (callback as? SignInCallback.Https)?.path,
            savedAt = now(),
        )
        runCatching { store.write(HopJson.encodeToString(SavedFlow.serializer(), flow)) }
    }

    /**
     * The flow an earlier process started, if the API would still finish it
     * and it still comes back only to Hop. Anything else is forgotten.
     */
    private fun restore(): Session.Started? {
        val stored = saved?.read() ?: return null
        val flow = runCatching { HopJson.decodeFromString(SavedFlow.serializer(), stored) }.getOrNull()
        val started = flow?.takeIf { now() - it.savedAt in 0..FLOW_LIFETIME_MS }?.started()
            ?.takeIf { session.trusts(it.callback) }
        if (started == null) forget() else pending = started
        return started
    }

    private fun forget() {
        runCatching { saved?.delete() }
    }

    @Serializable
    private class SavedFlow(
        val authorizeUrl: String,
        val flow: String,
        val scheme: String? = null,
        val host: String? = null,
        val path: String? = null,
        val savedAt: Long,
    ) {
        fun started(): Session.Started? {
            val url = authorizeUrl.toHttpUrlOrNull() ?: return null
            val callback = when {
                scheme != null -> SignInCallback.Scheme(scheme)
                host != null && path != null -> SignInCallback.Https(host, path)
                else -> return null
            }
            return Session.Started(url, flow, callback)
        }
    }

    private companion object {
        /** As long as the API keeps a sign-in flow (FLOW_TTL_MS in apps/api/src/routes/auth.ts). */
        const val FLOW_LIFETIME_MS = 10 * 60_000L
    }

    fun dismissError() {
        if (_status.value is Status.Failed) _status.value = Status.Idle
    }

    private fun describe(error: Exception): String = when (error) {
        is ApiError -> error.serverMessage ?: "Couldn’t sign in. Please try again."
        is IOException -> "Couldn’t reach Hop. Are you online?"
        else -> "Couldn’t sign in. Please try again."
    }
}
