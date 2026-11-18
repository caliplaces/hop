package com.onmyhop.app.auth

import android.net.Uri
import com.onmyhop.app.core.ApiError
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.receiveAsFlow
import kotlinx.coroutines.launch
import java.io.IOException

/**
 * Signing in, across the app and the browser. It outlives any one activity:
 * Android may recreate the activity while Caliplaces' page is showing, and
 * the redirect can come back through the Auth Tab's result or, in browsers
 * without Auth Tabs, through SignInCallbackActivity.
 */
class SignIn(private val session: Session, private val scope: CoroutineScope) {
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
    fun redirected(uri: Uri) =
        redirected(uri.scheme, uri.host, uri.path, uri.getQueryParameter("state"), uri.toString())

    internal fun redirected(scheme: String?, host: String?, path: String?, state: String?, url: String) {
        val started = pending ?: return
        if (!started.callback.matches(scheme, host, path)) return
        if (started.state != null && state != started.state) return
        pending = null
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
        _status.value = Status.Failed(message)
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
