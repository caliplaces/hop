package com.onmyhop.app.core

import android.content.Context
import android.text.format.Formatter
import com.onmyhop.app.R
import kotlinx.serialization.Serializable

/**
 * An event's inbox ("hop"), as `GET /api/me/hops` describes it. Every
 * athlete has one from the start; events add more.
 */
@Serializable
data class Hop(
    val id: String,
    val slug: String,
    val title: String,
    /** "open" while it takes uploads, "closed" after. */
    val status: String,
    /** Milliseconds since 1970, as the API sends times. */
    val createdAt: Long,
    val fileCount: Int,
    val totalBytes: Long,
) {
    val isClosed: Boolean get() = status == "closed"

    /** "12 clips · 1.2 GB" */
    fun summary(context: Context): String {
        val clips = context.resources.getQuantityString(R.plurals.clip_count, fileCount, fileCount)
        if (totalBytes <= 0) return clips
        return "$clips · ${Formatter.formatShortFileSize(context, totalBytes)}"
    }
}

@Serializable
data class HopsReply(val hops: List<Hop>)
