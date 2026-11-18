package com.onmyhop.app.push

import android.content.SharedPreferences
import androidx.core.content.edit
import com.onmyhop.app.auth.Session
import com.onmyhop.app.core.ApiClient
import com.onmyhop.app.core.HopJson
import com.onmyhop.app.feature.event.EventMode
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
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
) {
    /** Whether this build has push notifications at all. */
    val isAvailable: Boolean get() = tokens != null

    private val _arrivals = MutableStateFlow(0)

    /** Goes up as notifications of new clips arrive, so the inbox can reload. */
    val arrivals: StateFlow<Int> = _arrivals.asStateFlow()

    private val changes = Mutex()

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
        scope.launch {
            // Someone signed in, or the app launched with them signed in, once their profile is in.
            session.state.map { it.me?.id }.distinctUntilChanged().collect { if (it != null) refresh() }
        }
        scope.launch {
            // Only once Event mode has caught up with the launch, so an event
            // about to resume isn't taken back first.
            eventMode.state.filter { it.hasSettled }.map { it.run }.distinctUntilChanged()
                .collect { run -> changes.withLock { follow(run) } }
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

    /** A push arrived; shown if it's for the athlete signed in here. Any thread. */
    fun received(data: Map<String, String>) {
        val registration = registration
        when (val message = PushMessage.parse(data, registration)) {
            is PushMessage.Clips -> {
                notifier.clips(message)
                _arrivals.update { it + 1 }
            }
            is PushMessage.Expiring -> notifier.expiring(message)
            is PushMessage.Event -> scope.launch {
                eventMode.pushed(registration?.userId ?: return@launch, message.hopId, message.clips, message.latest, message.at)
            }
            null -> Unit
        }
    }

    /**
     * Someone signed out, or was (their session ended, or the account was
     * deleted). With [api], the session the server still knows: the API stops
     * pushing here first. Either way, FCM drops the token.
     */
    suspend fun signedOut(api: ApiClient?) = changes.withLock {
        registeredFor = null
        val registration = registration ?: return@withLock
        if (api != null) {
            if (preferences.contains(WATCHING)) attempt { api.delete("api/me/live-activities/${registration.token}") }
            attempt { api.delete("api/me/devices/${registration.token}") }
        }
        preferences.edit(commit = true) {
            remove(REGISTRATION)
            remove(WATCHING)
        }
        attempt { tokens?.delete() }
    }

    private suspend fun register(again: Boolean) {
        val tokens = tokens ?: return
        val me = session.me ?: return
        val sessionToken = session.token ?: return
        if (!allowed()) return
        if (!again && registeredFor == me.id && registration?.userId == me.id) return
        // FCM or the API out of reach: tried again next launch.
        val token = attempt { tokens.token() } ?: return
        attempt { session.client(sessionToken).put<DeviceBody, Done>("api/me/devices/$token", DeviceBody(FCM)) } ?: return
        // Kept even if they signed out meanwhile: the sign-out, waiting its
        // turn, then takes it back from the API.
        preferences.edit(commit = true) {
            putString(REGISTRATION, HopJson.encodeToString(Registration.serializer(), Registration(me.id, token)))
        }
        registeredFor = me.id
        // Event mode already running: its count comes here too.
        follow(eventMode.run)
    }

    /** Has the API update Event mode's count on this phone while it runs, and stop when it ends. */
    private suspend fun follow(run: EventMode.Run?) {
        val registration = registration ?: return
        val sessionToken = session.token ?: return
        val api = session.client(sessionToken)
        val path = "api/me/live-activities/${registration.token}"
        if (run != null && run.userId == registration.userId) {
            attempt { api.put<LiveBody, Done>(path, LiveBody(run.hopId, run.since, FCM)) } ?: return
            preferences.edit(commit = true) { putString(WATCHING, run.hopId) }
        } else if (run == null && preferences.contains(WATCHING)) {
            attempt { api.delete(path) } ?: return
            preferences.edit(commit = true) { remove(WATCHING) }
        }
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
        const val ASKED = "push.asked"
    }
}
