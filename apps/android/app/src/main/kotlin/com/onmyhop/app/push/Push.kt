package com.onmyhop.app.push

import android.content.SharedPreferences
import androidx.core.content.edit
import com.onmyhop.app.auth.Session
import com.onmyhop.app.core.ApiClient
import com.onmyhop.app.core.ApiError
import com.onmyhop.app.core.HopJson
import com.onmyhop.app.feature.event.EventMode
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.filter
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable

/**
 * Push notifications on this phone (see "Android pushes" in
 * apps/api/README.md). While someone is signed in and notifications are
 * allowed, the API has this install's FCM token for them, and for Event mode
 * while it runs. Signing out takes it back: from the API, and from FCM, which
 * then refuses pushes to it even if the API never heard of the sign-out.
 *
 * One change at a time, in order: a sign-out waits for a registration on its
 * way, then undoes it.
 */
class Push(
    private val session: Session,
    /** Null in builds without Firebase, which have no push notifications. */
    private val tokens: PushTokens?,
    private val preferences: SharedPreferences,
    private val eventMode: EventMode,
    private val notifier: PushNotifier,
    /** Whether Hop may show notifications here. */
    private val allowed: () -> Boolean,
    private val scope: CoroutineScope,
    /** How long to wait before telling the API about Event mode again, after [failures] tries that failed. */
    private val retryAfter: (failures: Int) -> Long = { failures ->
        (RETRY_FIRST_MS shl (failures - 1).coerceIn(0, 10)).coerceAtMost(RETRY_MOST_MS)
    },
) {
    /** Whether this build has push notifications at all. */
    val isAvailable: Boolean get() = tokens != null

    private val _arrivals = MutableStateFlow(0)

    /** Goes up as notifications of new clips arrive, so the inbox can reload. */
    val arrivals: StateFlow<Int> = _arrivals.asStateFlow()

    private val changes = Mutex()

    /**
     * Showing a push and clearing them all at sign-out take turns: one shown
     * before the clear is cleared, and one after finds nobody signed in.
     */
    private val showing = Any()

    private val _askDismissed = MutableStateFlow(preferences.getBoolean(ASK_DISMISSED, false))

    /** The inbox's card asking for notifications was put away. */
    val askDismissed: StateFlow<Boolean> = _askDismissed.asStateFlow()

    fun dismissAsk() {
        preferences.edit { putBoolean(ASK_DISMISSED, true) }
        _askDismissed.value = true
    }

    /** Whether Hop has shown Android's prompt for notifications. */
    val hasAsked: Boolean get() = preferences.getBoolean(ASKED, false)

    fun markAsked() {
        preferences.edit { putBoolean(ASKED, true) }
    }

    /** The athlete this launch has registered for, so coming back to the app doesn't again. */
    private var registeredFor: String? = null

    /** This install's token as the API has it, and whose; null while it has none. */
    val registration: Registration?
        get() = preferences.getString(REGISTRATION, null)?.let {
            runCatching { HopJson.decodeFromString(Registration.serializer(), it) }.getOrNull()
        }

    /** Starts following the session and Event mode. Once, from the app. */
    fun start() {
        session.onSignOut = ::signedOut
        // A sign-out the app was closed in the middle of: finished now.
        val unfinished = registration != null || preferences.getBoolean(TOKEN_ISSUED, false)
        if (session.token == null && unfinished) scope.launch { signedOut(null) }
        scope.launch {
            // Someone signed in, or the app launched with them signed in, once their profile is in.
            session.state.map { it.me?.id }.distinctUntilChanged().collect { if (it != null) refresh() }
        }
        scope.launch {
            // Only once Event mode has caught up with the launch, so an event
            // about to resume isn't taken back first.
            eventMode.state.filter { it.hasSettled }.map { it.run }.distinctUntilChanged()
                .collect { run -> keepFollowing(run) }
        }
    }

    /**
     * Registers this phone for the signed-in athlete, if notifications are
     * allowed and this launch hasn't yet: each launch, as the API forgets
     * tokens not refreshed in 90 days, and as soon as notifications are
     * turned on.
     */
    fun refresh(): Job = scope.launch { changes.withLock { register(again = false) } }

    /** FCM gave this install a new token. */
    fun tokenChanged(): Job = scope.launch { changes.withLock { register(again = true) } }

    /**
     * A push arrived; shown if it's for the athlete signed in here. Nothing
     * is, while nobody is: not while a sign-out is still taking the token
     * back. Any thread.
     */
    fun received(data: Map<String, String>): Unit = synchronized(showing) {
        if (session.token == null) return
        val registration = registration ?: return
        // Someone else signed in before their own registration took this one's place.
        if (session.me?.id.let { it != null && it != registration.userId }) return
        when (val message = PushMessage.parse(data, registration)) {
            is PushMessage.Clips -> {
                notifier.clips(message)
                _arrivals.update { it + 1 }
            }
            is PushMessage.Expiring -> notifier.expiring(message)
            is PushMessage.Event -> {
                scope.launch {
                    // Event mode lives on the main thread; still theirs by the time it gets there.
                    if (session.token == null) return@launch
                    eventMode.pushed(registration.userId, message.hopId, message.since, message.clips, message.latest, message.at)
                }
            }
            null -> Unit
        }
    }

    /**
     * Someone signed out, or was (their session ended, or the account was
     * deleted). Their notifications leave the phone at once. With [api], the
     * session the server still knows, the API stops pushing here. Then FCM
     * drops the token, so pushes to it stop even where the API never heard
     * of this; until that has worked, each launch signed out tries again.
     */
    suspend fun signedOut(api: ApiClient?) {
        synchronized(showing) { notifier.clear() }
        changes.withLock {
            registeredFor = null
            val registration = registration
            if (api != null && registration != null) {
                if (preferences.contains(WATCHING)) attempt { api.delete("api/me/live-activities/${registration.token}") }
                attempt { api.delete("api/me/devices/${registration.token}") }
            }
            preferences.edit(commit = true) {
                remove(REGISTRATION)
                remove(WATCHING)
            }
            // Whenever FCM gave a token, even one the API's reply about never came back.
            if (preferences.getBoolean(TOKEN_ISSUED, false) && attempt { tokens?.delete() } != null) {
                preferences.edit(commit = true) { remove(TOKEN_ISSUED) }
            }
        }
    }

    private suspend fun register(again: Boolean) {
        val tokens = tokens ?: return
        val me = session.me ?: return
        val sessionToken = session.token ?: return
        if (!allowed()) return
        if (!again && registeredFor == me.id && registration?.userId == me.id) return
        // FCM or the API out of reach: tried again next launch.
        val token = attempt { tokens.token() } ?: return
        preferences.edit(commit = true) { putBoolean(TOKEN_ISSUED, true) }
        attempt { session.client(sessionToken).put<DeviceBody, Done>("api/me/devices/$token", DeviceBody(FCM)) } ?: return
        // Kept even if they signed out meanwhile: the sign-out, waiting its
        // turn, then takes it back from the API.
        preferences.edit(commit = true) {
            putString(REGISTRATION, HopJson.encodeToString(Registration.serializer(), Registration(me.id, token)))
        }
        registeredFor = me.id
        // Event mode already running: its count comes here too.
        keepFollowing(eventMode.run)
    }

    /** Bringing the API in line with Event mode, for its newest run. */
    private var following: Job? = null
    private val followingLock = Any()

    /**
     * Has the API follow [run], or stop following when it's null. While the
     * API can't be reached it tries again, waiting longer each time, until it
     * gets through or Event mode changes: a phone offline as an event starts
     * still gets its count once it's back, and one offline as it ends still
     * stops, so the event's notifications of new clips aren't held back.
     */
    private fun keepFollowing(run: EventMode.Run?) = synchronized(followingLock) {
        following?.cancel()
        following = scope.launch {
            var failures = 0
            // A try runs to its end once begun, so what the phone notes the API follows stays true.
            while (!changes.withLock { withContext(NonCancellable) { follow(run) } }) {
                delay(retryAfter(++failures))
            }
        }
    }

    /**
     * Has the API update Event mode's count on this phone while it runs, and
     * stop when it ends. False when the API couldn't be reached, to try again.
     * Nothing to do (true) without a registration: registering follows Event
     * mode itself.
     */
    private suspend fun follow(run: EventMode.Run?): Boolean {
        val registration = registration ?: return true
        val sessionToken = session.token ?: return true
        val api = session.client(sessionToken)
        val path = "api/me/live-activities/${registration.token}"
        if (run != null && run.userId == registration.userId) {
            when (send { api.put<LiveBody, Done>(path, LiveBody(run.hopId, run.since, FCM)) }) {
                Sent.Through -> preferences.edit(commit = true) { putString(WATCHING, run.hopId) }
                // The event is gone, say: asking again wouldn't change the answer.
                Sent.Refused -> Unit
                Sent.Again -> return false
            }
        } else if (run == null && preferences.contains(WATCHING)) {
            // Refused, there's nothing left to stop.
            if (send { api.delete(path) } == Sent.Again) return false
            preferences.edit(commit = true) { remove(WATCHING) }
        }
        return true
    }

    private enum class Sent { Through, Refused, Again }

    /** How a request went: through, refused for good (a 4xx, other than too many requests), or worth trying again. */
    private suspend fun send(block: suspend () -> Unit): Sent = try {
        block()
        Sent.Through
    } catch (error: CancellationException) {
        throw error
    } catch (error: ApiError) {
        if (error.status in 400..499 && error.status != 429) Sent.Refused else Sent.Again
    } catch (_: Exception) {
        Sent.Again
    }

    /** Null when it failed: offline, or FCM or the API having a moment. */
    private suspend fun <T> attempt(block: suspend () -> T): T? = try {
        block()
    } catch (error: CancellationException) {
        throw error
    } catch (_: Exception) {
        null
    }

    // The platform is always sent: HopJson leaves defaults out.
    @Serializable
    private class DeviceBody(val platform: String)

    @Serializable
    private class LiveBody(val hopId: String, val since: Long, val platform: String)

    @Serializable
    private class Done

    private companion object {
        const val FCM = "fcm"
        const val REGISTRATION = "push.registration"

        /** The event the API is updating Event mode for here. */
        const val WATCHING = "push.watching"
        const val ASK_DISMISSED = "push.askDismissed"

        /** FCM has given this install a token that hasn't been deleted since. */
        const val TOKEN_ISSUED = "push.tokenIssued"
        const val ASKED = "push.asked"

        /** Event mode's retries: after 2 s, doubling up to 5 minutes. */
        const val RETRY_FIRST_MS = 2_000L
        const val RETRY_MOST_MS = 5 * 60_000L
    }
}
