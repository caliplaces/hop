package com.onmyhop.app.feature.profile

import android.content.ContentResolver
import android.net.Uri
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.onmyhop.app.auth.Session
import com.onmyhop.app.core.ApiError
import com.onmyhop.app.core.Me
import com.onmyhop.app.core.firstGrapheme
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch
import kotlinx.serialization.Serializable
import java.io.IOException
import java.text.Normalizer

/**
 * Changes to what others see of an athlete: their name and photo. Edits stay
 * here until saved. They're stored only in Hop, never in the Caliplaces
 * account they signed in with.
 */
class ProfileModel(me: Me, private val session: Session) : ViewModel() {
    sealed interface PhotoChange {
        data object Unchanged : PhotoChange
        class New(val jpeg: ByteArray) : PhotoChange
        data object Removed : PhotoChange
    }

    /** Saves belong to the session that opened this, even if they sign out meanwhile. */
    private val token = session.token

    var name by mutableStateOf(me.name.orEmpty())
    var photo: PhotoChange by mutableStateOf(PhotoChange.Unchanged)
        private set
    var isPreparingPhoto by mutableStateOf(false)
        private set
    var isSaving by mutableStateOf(false)
        private set

    /** Why the last photo or save failed. */
    var problem: String? by mutableStateOf(null)
        private set

    /** The profile as the server last returned it. */
    var me: Me by mutableStateOf(me)
        private set

    private var picking: Job? = null

    /** The name as it will be saved: like the API, NFC with single spaces. */
    val normalizedName: String
        get() = Normalizer.normalize(name, Normalizer.Form.NFC).trim().split(Regex("\\s+")).filter { it.isNotEmpty() }.joinToString(" ")

    /** What's wrong with the name, for the rules the app can tell; the API has the last word. */
    val nameProblem: NameProblem?
        get() {
            val name = normalizedName
            return when {
                name.isEmpty() -> NameProblem.Empty
                name.length > MAX_NAME_LENGTH -> NameProblem.TooLong
                name.startsWith("@") -> NameProblem.StartsWithAt
                else -> null
            }
        }

    enum class NameProblem { Empty, TooLong, StartsWithAt }

    val nameChanged: Boolean get() = normalizedName != me.name.orEmpty()
    val hasChanges: Boolean get() = nameChanged || photo != PhotoChange.Unchanged
    val canSave: Boolean get() = !isSaving && !isPreparingPhoto && nameProblem == null

    /** The photo as it would look saved: new bytes, the saved photo's URL, or nothing. */
    val shownPhoto: Any?
        get() = when (val change = photo) {
            is PhotoChange.New -> change.jpeg
            PhotoChange.Removed -> null
            PhotoChange.Unchanged -> me.avatar()?.toString()
        }

    /** The initial as it would look saved, following the name as it's typed. */
    val shownInitial: String get() = normalizedName.firstGrapheme()?.uppercase() ?: me.initial

    val hasPhoto: Boolean
        get() = when (photo) {
            is PhotoChange.New -> true
            PhotoChange.Removed -> false
            PhotoChange.Unchanged -> me.avatarUrl != null
        }

    /** Prepares a picked photo; a newer pick replaces one still being prepared. */
    fun choosePhoto(resolver: ContentResolver, uri: Uri) {
        picking?.cancel()
        isPreparingPhoto = true
        problem = null
        picking = viewModelScope.launch {
            try {
                photo = PhotoChange.New(ProfilePhoto.prepare(resolver, uri))
            } catch (error: ProfilePhoto.Unreadable) {
                problem = error.message
            } finally {
                isPreparingPhoto = false
            }
        }
    }

    fun removePhoto() {
        picking?.cancel()
        isPreparingPhoto = false
        photo = if (me.avatarUrl == null) PhotoChange.Unchanged else PhotoChange.Removed
    }

    /**
     * Saves what changed, and with [confirming], that they've seen their
     * profile. Returns whether everything was saved.
     */
    suspend fun save(confirming: Boolean = false): Boolean {
        if (!canSave) return false
        isSaving = true
        problem = null
        try {
            when (val change = photo) {
                is PhotoChange.New -> {
                    val reply: Reply = session.api.putBytes("api/me/avatar", change.jpeg, "image/jpeg")
                    accept(reply.me)
                    photo = PhotoChange.Unchanged
                }
                PhotoChange.Removed -> {
                    val reply: Reply = session.api.deleteFor("api/me/avatar")
                    accept(reply.me)
                    photo = PhotoChange.Unchanged
                }
                PhotoChange.Unchanged -> {}
            }
            val changes = Changes(
                displayName = if (nameChanged) normalizedName else null,
                profileReviewed = if (confirming && !me.profileReviewed) true else null,
            )
            if (changes.displayName != null || changes.profileReviewed != null) {
                val reply: Reply = session.api.patch("api/me", changes)
                accept(reply.me)
            }
            return true
        } catch (error: ApiError) {
            problem = error.message
        } catch (_: IOException) {
            problem = "Couldn’t reach Hop. Are you online?"
        } finally {
            isSaving = false
        }
        return false
    }

    /**
     * Takes a newer copy of the profile. A name they haven't touched follows
     * it, so a stale one is never sent back over a newer one; a name they're
     * editing, and a photo they've picked, are kept.
     */
    fun sync(newer: Me) {
        if (newer == me) return
        if (normalizedName == me.name.orEmpty()) name = newer.name.orEmpty()
        if (photo == PhotoChange.Removed && newer.avatarUrl == null) photo = PhotoChange.Unchanged
        me = newer
    }

    private fun accept(newer: Me) {
        sync(newer)
        session.update(newer, token)
    }

    /** Only what changed: left out, not null, since a null name means "use the Caliplaces one". */
    @Serializable
    private class Changes(val displayName: String? = null, val profileReviewed: Boolean? = null)

    @Serializable
    private class Reply(val me: Me)

    companion object {
        /** The most a name can be, as the API counts it (UTF-16 code units, like Kotlin's length). */
        const val MAX_NAME_LENGTH = 50
    }
}
