package com.onmyhop.app.feature.event

import android.content.SharedPreferences
import androidx.core.content.edit
import com.onmyhop.app.core.ApiClient
import com.onmyhop.app.core.ApiError
import com.onmyhop.app.core.Clip
import com.onmyhop.app.core.Empty
import com.onmyhop.app.core.Hop
import com.onmyhop.app.core.HopJson
import com.onmyhop.app.core.HopsReply
import com.onmyhop.app.core.Me
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.isActive
import kotlin.coroutines.coroutineContext
import kotlinx.serialization.Serializable

/**
 * Event mode: the athlete's QR code full screen, the screen kept on, and a
 * count of the clips coming in, in the app and in an ongoing notification.
 *
 * It lives as long as the app, outside any screen, so the running event
 * survives switching tabs and relaunching. It counts while the app is open;
 * otherwise the API pushes the count to the notification (in builds with
 * push notifications; without them it shows the last count the app saw).
 */
class EventMode(
    private val preferences: SharedPreferences,
    private val notifier: EventNotifier,
    private val now: () -> Long = System::currentTimeMillis,
) {
    /** An event Event mode is running for: where clips go, and since when. */
    @Serializable
    data class Run(
        /** The athlete it belongs to, so it never carries over to another account. */
        val userId: String,
        val hopId: String,
        val title: String,
        /** When it started, by this phone's clock, for how long it has been live. */
        val startedAt: Long,
        /** The same moment by the server's clock: clips that finish uploading from then on count. */
        val since: Long,
    )

    /** Where clips should go when Event mode starts. */
    sealed interface Target {
        /** A new event with this name, which the link then uploads into. */
        data class NewEvent(val title: String) : Target

        /** An event the athlete already has. */
        data class Existing(val hop: Hop) : Target
    }

    /** Clips that came in together, for one "Mia sent a clip" moment. */
    data class Arrival(val id: Long, val count: Int, val senders: List<String?>)

    data class State(
        val run: Run? = null,
        /** Clips sent since Event mode started. */
        val clips: Int = 0,
        /** Who sent the latest clip. */
        val latest: String? = null,
        /** The newest burst of clips, for the screens to celebrate. */
        val arrival: Arrival? = null,
        /** Set while the server can't be reached. */
        val isOffline: Boolean = false,
        /**
         * Whether Event mode has caught up with this launch: resumed the event
         * that was running, or found there wasn't one. Links into the app wait
         * for it, so they open the right screen.
         */
        val hasSettled: Boolean = false,
    )

    private val _state = MutableStateFlow(State())
    val state: StateFlow<State> = _state.asStateFlow()
    val run: Run? get() = _state.value.run

    /** Bumped whenever the run starts, ends or is reset, so an older answer can't change the current one. */
    private var generation = 0

    /**
     * The count the notification shows, which only goes up: a push can be
     * ahead of the app's own checks, and a check answered late behind it.
     */
    private var shown = -1

    /** Clips already announced, so none is celebrated twice. */
    private val announced = mutableSetOf<String>()

    /** After a relaunch, until a check succeeds: catch up quietly rather than celebrate old clips. */
    private var catchingUp = false
    private var arrivals = 0L

    /** The newest arrival a screen has celebrated, so reopening the stage doesn't buzz for it again. */
    private var celebrated = 0L

    /**
     * Claims [arrival] for celebrating: true the first time it's asked about,
     * false after, whichever screen asks.
     */
    fun celebrate(arrival: Arrival): Boolean {
        if (arrival.id <= celebrated) return false
        celebrated = arrival.id
        return true
    }

    /**
     * Picks up an event that was running when the app last quit, if it
     * belongs to this athlete and hasn't run out. Otherwise clears it.
     */
    fun resume(me: Me) {
        val current = run
        if (current != null) {
            if (current.userId != me.id) reset()
            _state.update { it.copy(hasSettled = true) }
            return
        }
        val saved = saved()
        if (saved != null && saved.userId == me.id && now() - saved.startedAt < MAX_DURATION_MS) {
            generation++
            catchingUp = true
            announced.clear()
            // The last count a push brought while the app was closed, until it checks.
            val clips = preferences.getInt(PUSHED_CLIPS, 0)
            val latest = preferences.getString(PUSHED_LATEST, null)
            _state.value = State(run = saved, clips = clips, latest = latest, hasSettled = true)
            shown = -1
            show(saved, clips, latest)
            return
        }
        clear()
        _state.update { it.copy(hasSettled = true) }
    }

    /** Starts Event mode: points the athlete's link at the event, then starts counting. */
    suspend fun start(target: Target, me: Me, api: ApiClient) {
        val asked = ++generation
        val hop = when (target) {
            is Target.NewEvent -> create(target.title, api)
            is Target.Existing -> target.hop
        }
        val activation: Activation = api.post("api/me/hops/${hop.id}/activate", Empty)
        // Ended, reset or started again while this was on its way.
        if (asked != generation) return
        val started = Run(userId = me.id, hopId = hop.id, title = hop.title, startedAt = now(), since = activation.activatedAt)
        announced.clear()
        catchingUp = false
        preferences.edit(commit = true) {
            putString(KEY, HopJson.encodeToString(Run.serializer(), started))
            removePushed()
        }
        _state.value = State(run = started, hasSettled = true)
        shown = -1
        show(started, clips = 0, latest = null)
    }

    /** Stops Event mode. The link keeps uploading into the event, for the clips sent on the way home. */
    fun end() {
        generation++
        clear()
        _state.update { State(hasSettled = it.hasSettled) }
    }

    /** Ends Event mode when its athlete signs out. The next athlete's launch settles again. */
    fun reset() {
        generation++
        clear()
        _state.value = State()
    }

    /**
     * Event mode's count from a push, which comes whether or not the app is
     * open: for the event running here, from its own athlete, and newer than
     * the last. It goes to the notification. While the app is open its own
     * checks keep the count, celebrating what lands; a push only moves the
     * notification ahead of them, never back.
     */
    fun pushed(userId: String, hopId: String, since: Long?, clips: Int, latest: String?, at: Long) {
        val current = run ?: saved()
        if (current == null || current.userId != userId || current.hopId != hopId) return
        // Only this run's: not one from before Event mode started again for the same event.
        if ((since != null && since != current.since) || at < current.since) return
        if (now() - current.startedAt >= MAX_DURATION_MS) return
        if (at <= preferences.getLong(PUSHED_AT, 0L)) return
        preferences.edit(commit = true) {
            putLong(PUSHED_AT, at)
            putInt(PUSHED_CLIPS, clips)
            if (latest != null) putString(PUSHED_LATEST, latest) else remove(PUSHED_LATEST)
        }
        if (run != null && clips <= _state.value.clips) return
        show(current, clips, latest)
    }

    /** Checks for new clips once. */
    suspend fun poll(api: ApiClient) {
        val current = run ?: return
        val asked = generation
        if (now() - current.startedAt >= MAX_DURATION_MS) {
            end()
            return
        }
        try {
            val reply: Arrivals = api.get("api/me/hops/${current.hopId}/arrivals", mapOf("since" to current.since.toString()))
            if (asked != generation) return
            val quietly = catchingUp
            catchingUp = false
            val previous = _state.value.clips
            // Newest first; only clips not celebrated before are news.
            val fresh = reply.latest.filter { it.id !in announced }
            announced += reply.latest.map { it.id }
            val latest = reply.latest.firstOrNull()?.contributorName
            val arrival = if (reply.count > previous && !quietly) {
                Arrival(id = ++arrivals, count = reply.count - previous, senders = fresh.map { it.contributorName })
            } else {
                _state.value.arrival
            }
            val before = _state.value
            _state.value = before.copy(clips = reply.count, latest = latest, arrival = arrival, isOffline = false)
            if (before.clips != reply.count || before.latest != latest) show(current, reply.count, latest)
        } catch (error: CancellationException) {
            throw error
        } catch (error: ApiError) {
            if (asked != generation) return
            // The event was deleted, on the website perhaps.
            if (error.status == 404) end() else _state.update { it.copy(isOffline = true) }
        } catch (_: Exception) {
            if (asked == generation) _state.update { it.copy(isOffline = true) }
        }
    }

    /** Checks for new clips every [intervalMs] until cancelled or Event mode ends. */
    suspend fun watch(api: ApiClient, intervalMs: Long) {
        while (coroutineContext.isActive && run != null) {
            poll(api)
            delay(intervalMs)
        }
    }

    /**
     * Creates the event, with a link name from its title that the athlete
     * doesn't have yet. If another device takes it meanwhile, looks again.
     */
    private suspend fun create(title: String, api: ApiClient): Hop {
        var attempt = 1
        while (true) {
            val mine: HopsReply = api.get("api/me/hops")
            val slug = EventLink.free(title, mine.hops.map { it.slug }.toSet())
            try {
                return api.post<NewHop, HopReply>("api/me/hops", NewHop(title, slug)).hop
            } catch (error: ApiError) {
                if (error.code != "slug_taken" || attempt >= 3) throw error
                attempt++
            }
        }
    }

    /** Updates the notification, never to fewer clips than it shows. */
    private fun show(run: Run, clips: Int, latest: String?) {
        if (clips < shown) return
        shown = clips
        notifier.show(run, clips, latest)
    }

    private fun saved(): Run? =
        preferences.getString(KEY, null)?.let { runCatching { HopJson.decodeFromString<Run>(it) }.getOrNull() }

    private fun SharedPreferences.Editor.removePushed() {
        remove(PUSHED_AT)
        remove(PUSHED_CLIPS)
        remove(PUSHED_LATEST)
    }

    private fun clear() {
        shown = -1
        preferences.edit(commit = true) {
            remove(KEY)
            removePushed()
        }
        announced.clear()
        catchingUp = false
        notifier.clear()
    }

    @Serializable
    private class Activation(val activatedAt: Long)

    @Serializable
    private class Arrivals(val count: Int, val latest: List<Clip> = emptyList())

    @Serializable
    private class NewHop(val title: String, val slug: String)

    @Serializable
    private class HopReply(val hop: Hop)

    companion object {
        /** Events stop on their own after this long. */
        const val MAX_DURATION_MS = 12L * 60 * 60 * 1000
        private const val KEY = "event.run"

        /** The newest count a push brought for the running event: when (server clock), how many, and from whom. */
        private const val PUSHED_AT = "event.pushed.at"
        private const val PUSHED_CLIPS = "event.pushed.clips"
        private const val PUSHED_LATEST = "event.pushed.latest"
    }
}

/** Where Event mode shows itself outside the app. */
interface EventNotifier {
    fun show(run: EventMode.Run, clips: Int, latest: String?)
    fun clear()
}
