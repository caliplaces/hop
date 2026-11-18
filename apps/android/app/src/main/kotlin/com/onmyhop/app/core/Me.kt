package com.onmyhop.app.core

import com.onmyhop.app.design.Palette
import com.onmyhop.app.design.PaletteColor
import kotlinx.serialization.Serializable
import okhttp3.HttpUrl

/**
 * The signed-in athlete, as `GET /api/me` describes them. Fields newer than
 * the first app release have defaults, for servers from before them.
 */
@Serializable
data class Me(
    val id: String,
    /** The name others see: the one they set in Hop, or else their Caliplaces account's. */
    val name: String? = null,
    val email: String? = null,
    /** Their onmyhop.com/<handle>, once claimed. */
    val handle: String? = null,
    val activeHopId: String? = null,
    /** A palette colour id. */
    val color: String,
    val emailNewClips: Boolean = true,
    /** Servers from before new-clip notifications don't say: they're on. */
    val pushNewClips: Boolean = true,
    /** Their profile photo, relative to the site; without one, their initial shows. */
    val avatarUrl: String? = null,
    /** They have Hop+, which their page shows with a Hop+ mark. */
    val hopPlus: Boolean = false,
    /**
     * They've seen and confirmed what their page shows about them. Servers
     * from before profiles don't say, and couldn't save it, so there's
     * nothing to ask them to confirm.
     */
    val profileReviewed: Boolean = true,
) {
    val paletteColor: PaletteColor get() = Palette.color(color)

    /** Their upload page, on the server this build talks to. */
    fun link(server: HttpUrl = HopServer.baseUrl): HttpUrl? =
        handle?.let { server.newBuilder().addPathSegment(it).build() }

    /** Their photo, on the server this build talks to: only ever a path on Hop's own site. */
    fun avatar(server: HttpUrl = HopServer.baseUrl): HttpUrl? {
        val path = avatarUrl ?: return null
        if (!path.startsWith("/") || path.startsWith("//")) return null
        return server.resolve(path)?.takeIf { it.scheme == server.scheme && it.host == server.host && it.port == server.port }
    }

    /** The first letter of what they're called, for when there's no photo. */
    val initial: String
        get() {
            val source = name ?: handle ?: email ?: ""
            return source.firstGrapheme()?.uppercase() ?: "?"
        }
}

/** The first user-perceived character, so an emoji or accented letter stays whole. */
fun String.firstGrapheme(): String? {
    if (isEmpty()) return null
    val iterator = java.text.BreakIterator.getCharacterInstance()
    iterator.setText(this)
    val end = iterator.next()
    return if (end == java.text.BreakIterator.DONE) this else substring(0, end)
}

/** How a link reads out loud: onmyhop.com/maya, without the scheme. */
val HttpUrl.spoken: String
    get() = buildString {
        append(host)
        if (port != HttpUrl.defaultPort(scheme)) append(":").append(port)
        append(encodedPath.trimEnd('/'))
    }
