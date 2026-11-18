package com.onmyhop.app.feature.claim

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.onmyhop.app.auth.Session
import com.onmyhop.app.core.ApiError
import com.onmyhop.app.core.Me
import com.onmyhop.app.design.Palette
import com.onmyhop.app.design.PaletteColor
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.serialization.Serializable

/** Claiming a handle: checks availability as they type, and claims it in their colour. */
class ClaimModel(me: Me, private val session: Session, private val debounceMs: Long = 350) : ViewModel() {
    sealed interface Status {
        /** Nothing typed yet. */
        data object Idle : Status
        data object Checking : Status
        data object Available : Status
        data class Unavailable(val reason: Reason) : Status
    }

    /** Why a handle can't be had, in the website's words (see strings.xml). */
    enum class Reason { Invalid, Reserved, NotAllowed, Taken, Offline }

    var input by mutableStateOf(HandleRules.suggestion(me.name, me.email))
        private set
    var color: PaletteColor by mutableStateOf(me.paletteColor)
    var status: Status by mutableStateOf(Status.Idle)
        private set
    var isClaiming by mutableStateOf(false)
        private set

    /** Why the last claim failed, when it wasn't the handle's fault. */
    sealed interface Problem {
        data object Offline : Problem
        data class Server(val message: String) : Problem
    }

    var problem: Problem? by mutableStateOf(null)
        private set

    val handle: String get() = HandleRules.normalize(input)
    val canClaim: Boolean get() = status == Status.Available && !isClaiming

    private var check: Job? = null

    init {
        scheduleCheck()
    }

    fun type(text: String) {
        if (text == input) return
        input = text
        scheduleCheck()
    }

    /** Whether the last check couldn't reach Hop, so it's worth asking again. */
    val checkFailed: Boolean get() = (status as? Status.Unavailable)?.reason == Reason.Offline

    /** Checks the same handle again, after a check that couldn't reach Hop. */
    fun retry() {
        if (checkFailed) scheduleCheck()
    }

    /** Checks the handle a moment after they stop typing, dropping older checks. */
    private fun scheduleCheck() {
        check?.cancel()
        problem = null
        val handle = handle
        if (handle.isEmpty()) {
            status = Status.Idle
            return
        }
        if (!HandleRules.isValid(handle)) {
            status = Status.Unavailable(Reason.Invalid)
            return
        }
        status = Status.Checking
        check = viewModelScope.launch {
            delay(debounceMs)
            val result = try {
                val reply = session.api.get<Availability>("api/handles/$handle")
                if (reply.available) Status.Available else Status.Unavailable(reason(reply.problem))
            } catch (_: ApiError) {
                Status.Unavailable(Reason.Offline)
            } catch (_: java.io.IOException) {
                Status.Unavailable(Reason.Offline)
            }
            if (handle == this@ClaimModel.handle) status = result
        }
    }

    /** Claims the handle in their colour; the session moves the app on. */
    fun claim() {
        if (!canClaim) return
        isClaiming = true
        problem = null
        val submitted = handle
        val token = session.token
        viewModelScope.launch {
            try {
                val reply: Claimed = session.api.put("api/me/handle", ClaimRequest(submitted, color.id))
                session.update(reply.me, token)
            } catch (error: ApiError) {
                if (error.code.startsWith("handle_")) {
                    // Only about the handle that was sent, if it's still the one typed.
                    if (handle == submitted) {
                        status = Status.Unavailable(if (error.code == "handle_taken") Reason.Taken else Reason.Invalid)
                    }
                } else {
                    problem = Problem.Server(error.message ?: "")
                }
            } catch (_: java.io.IOException) {
                // The handle may well be fine: they can tap again once online.
                problem = Problem.Offline
            } finally {
                isClaiming = false
            }
        }
    }

    private fun reason(problem: String?): Reason = when (problem) {
        "reserved" -> Reason.Reserved
        "invalid" -> Reason.Invalid
        "unavailable" -> Reason.NotAllowed
        else -> Reason.Taken
    }

    @Serializable
    private class Availability(val available: Boolean, val problem: String? = null)

    @Serializable
    private class ClaimRequest(val handle: String, val color: String)

    @Serializable
    private class Claimed(val me: Me)

    companion object {
        val colors: List<PaletteColor> = Palette.all
    }
}
