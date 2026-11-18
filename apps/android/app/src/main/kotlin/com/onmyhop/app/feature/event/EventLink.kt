package com.onmyhop.app.feature.event

import java.text.Normalizer

/**
 * The link name of an event (onmyhop.com/<handle>/<name>), made from its
 * title the way the website makes it: `slugify` in
 * packages/shared/src/handles.ts. `EventLinkTest` holds the two together.
 */
object EventLink {
    /** Link names are at most this long (`HOP_SLUG_PATTERN`). */
    const val MAX_LENGTH = 40

    /** For a title with nothing a link can use, such as one in Chinese or emoji. */
    const val FALLBACK = "event"

    /** "Mistrovství ČR 2026" becomes "mistrovstvi-cr-2026". */
    fun slug(title: String): String {
        val folded = Normalizer.normalize(title, Normalizer.Form.NFKD).replace(Regex("[\\u0300-\\u036f]"), "").lowercase()
        val slug = folded.split(Regex("[^a-z0-9]+")).filter { it.isNotEmpty() }.joinToString("-").take(MAX_LENGTH)
        return slug.removeSuffix("-")
    }

    /**
     * A link name for a new event that none of [taken] has: the title's, or
     * failing that "event", then numbered ("prague-open-2"), shortened where
     * needed so the number always fits.
     */
    fun free(title: String, taken: Set<String>): String {
        val base = slug(title).ifEmpty { FALLBACK }
        if (base !in taken) return base
        var number = 2
        while (true) {
            val suffix = "-$number"
            val candidate = base.take(MAX_LENGTH - suffix.length).trimEnd('-') + suffix
            if (candidate !in taken) return candidate
            number++
        }
    }
}
