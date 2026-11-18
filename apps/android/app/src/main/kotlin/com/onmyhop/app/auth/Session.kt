package com.onmyhop.app.auth

import com.onmyhop.app.core.ApiClient
import com.onmyhop.app.core.ApiError
import com.onmyhop.app.core.Empty
import com.onmyhop.app.core.HopServer
import com.onmyhop.app.core.Me
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.serialization.Serializable
import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import okhttp3.OkHttpClient

/**
 * Who is signed in, and signing in and out with a Caliplaces account.
 *
 * Sign-in runs in three steps, as in the iPhone app. Hop's API starts a flow
 * and returns Caliplaces' sign-in URL. The app shows that page in an Auth
 * Tab. Then it hands the URL Caliplaces redirected back to over to the API,
 * which trades the code for a Hop session. The app only ever holds that
 * session token, encrypted with a Keystore key (see KeystoreTokenStore).
 */
class Session(
    private val store: TokenStore,
    val baseUrl: HttpUrl,
    private val http: OkHttpClient,
) {
    data class State(val token: String?, val me: Me?) {
        val isSignedIn: Boolean get() = token != null
    }

    private val _state = MutableStateFlow(State(token = store.read(), me = null))
    val state: StateFlow<State> = _state.asStateFlow()

    val token: String? get() = _state.value.token
    val me: Me? get() = _state.value.me

    /** A client signed with this session, for the app's other screens. */
    val api: ApiClient get() = ApiClient(baseUrl, token, http)

    /** A sign-in the API has started: the page to show, and what it redirects back to. */
    data class Started(val authorizeUrl: HttpUrl, val flow: String, val callback: SignInCallback)

    /** Step 1: asks the API for a flow, and checks it comes back somewhere only Hop can catch. */
    suspend fun startSignIn(): Started {
        val reply: StartReply = api.post("api/auth/app/start", Empty)
        val url = reply.authorizeUrl.toHttpUrlOrNull()?.takeIf { it.isHttps }
            ?: throw ApiError(502, "bad_authorize_url", null)
        // Older servers don't say, and always use the custom scheme.
        val callback = reply.callback?.toCallback() ?: SignInCallback.CustomScheme
        if (!callback.isTrusted(baseUrl)) throw ApiError(502, "untrusted_callback", null)
        return Started(url, reply.flow, callback)
    }

    /** Steps 2 and 3: hands the redirect back to the API, which signs in. */
    suspend fun finishSignIn(started: Started, callbackUrl: String) {
        val reply: SessionReply = api.post(
            "api/auth/app/session",
            SessionRequest(flow = started.flow, callbackUrl = callbackUrl),
        )
        store.write(reply.token)
        _state.value = State(token = reply.token, me = reply.me)
    }

    /**
     * Takes a newer copy of the profile, such as the reply to claiming a
     * handle. `fromToken` is the session that asked for it; a reply for a
     * session that has since signed out, or been replaced, is dropped.
     */
    fun update(me: Me, fromToken: String?) {
        _state.update { current ->
            if (fromToken == null || fromToken != current.token) current else current.copy(me = me)
        }
    }

    /**
     * Reloads the profile. Signs out here if the server no longer knows the
     * session; keeps it when offline.
     */
    suspend fun refresh() {
        val asked = token ?: return
        val reply = try {
            api.get<MeReply>("api/me")
        } catch (_: Exception) {
            // Offline, or the server is having a moment: tried again next launch.
            return
        }
        // Signed out, or in as someone else, while this was on its way.
        if (token != asked) return
        val me = reply.me
        if (me != null) update(me, asked) else forget()
    }

    /**
     * Deletes the account on the server, for good, then forgets it here.
     * Throws, staying signed in, unless the server confirms.
     */
    suspend fun deleteAccount() {
        val asked = token ?: return
        try {
            api.delete("api/me")
        } catch (error: ApiError) {
            // The session is already gone, most likely a retry after the reply
            // to a deletion that went through was lost: it can't be used either way.
            if (error.status != 401) throw error
        }
        if (token == asked) forget()
    }

    /**
     * Signs out at once, then tells the server to end the session. `before`
     * runs with the session still valid on the server, such as telling it
     * this phone no longer takes the athlete's notifications.
     */
    suspend fun signOut(before: suspend (ApiClient) -> Unit = {}) {
        val client = api
        forget()
        runCatching { before(client) }
        runCatching { client.post("api/auth/logout") }
    }

    private fun forget() {
        store.delete()
        _state.value = State(token = null, me = null)
    }

    @Serializable
    private class StartReply(val authorizeUrl: String, val flow: String, val callback: CallbackReply? = null)

    @Serializable
    private class CallbackReply(val scheme: String? = null, val host: String? = null, val path: String? = null) {
        fun toCallback(): SignInCallback? = when {
            host != null && path != null -> SignInCallback.Https(host, path)
            scheme != null -> SignInCallback.Scheme(scheme)
            else -> null
        }
    }

    @Serializable
    private class SessionRequest(val flow: String, val callbackUrl: String)

    @Serializable
    private class SessionReply(val token: String, val me: Me)

    @Serializable
    private class MeReply(val me: Me? = null)
}

/** Where Caliplaces sends the app back to after signing in, as the API says. */
sealed interface SignInCallback {
    /** The app's custom scheme, which staging still uses. */
    data class Scheme(val scheme: String) : SignInCallback

    /**
     * An https page on Hop's site, which only Hop can catch: Chrome checks
     * that the site lists the app in its Digital Asset Links.
     */
    data class Https(val host: String, val path: String) : SignInCallback

    /** Only Hop's own callbacks: its custom scheme, or the callback page on the API's own host. */
    fun isTrusted(baseUrl: HttpUrl): Boolean = when (this) {
        is Scheme -> scheme == HopServer.CALLBACK_SCHEME
        is Https -> host == baseUrl.host && path == HTTPS_PATH
    }

    /** Whether a redirect the app received is this callback. */
    fun matches(scheme: String?, host: String?, path: String?): Boolean = when (this) {
        is Scheme -> scheme == this.scheme
        is Https -> scheme == "https" && host == this.host && path == this.path
    }

    companion object {
        val CustomScheme = Scheme(HopServer.CALLBACK_SCHEME)

        /** The API's https callback page. */
        const val HTTPS_PATH = "/api/auth/app/callback"
    }
}
