package com.onmyhop.app.core

import kotlinx.serialization.Serializable

/** One clip someone sent, as `GET /api/me/files` describes it. */
@Serializable
data class Clip(
    val id: String,
    val hopId: String,
    val name: String,
    val mime: String,
    val size: Long,
    val hasThumbnail: Boolean,
    /**
     * "@handle" for signed-in contributors, otherwise whatever they typed or a
     * random name like "SmokyMonkey441". Typed by a stranger: shown as text only.
     */
    val contributorName: String? = null,
    /** They were signed in, so the name is their real handle. */
    val contributorVerified: Boolean = false,
    val note: String? = null,
    /** Milliseconds since 1970, as the API sends times. */
    val createdAt: Long,
) {
    val isVideo: Boolean get() = mime.startsWith("video/")

    /** Its thumbnail, which needs the session (the image client adds it for the API's host). */
    val thumbnailPath: String get() = "api/me/files/$id/thumbnail"
}

@Serializable
data class ClipPage(val files: List<Clip>, val nextCursor: String? = null)

/** A short-lived link to a clip's bytes. */
@Serializable
data class ClipUrl(val url: String)

/** The athlete's plan and storage, as `GET /api/me/plan` describes it (the parts the app uses). */
@Serializable
data class PlanStatus(
    /** "free" or "plus". */
    val plan: String,
    val storage: Storage,
    /** Days free clips are kept; null with Hop+ (kept for good). */
    val retentionDays: Int? = null,
    /**
     * Free-plan clips the athlete has been told are leaving: how many, the day
     * the first notice named (YYYY-MM-DD), and when they may go.
     */
    val expiring: Expiring? = null,
    /** Goes up whenever the subscriptions change: a lower one than shown is stale. */
    val revision: Long = 0,
    /** With Hop+: where it was bought, when the period ends, and whether it renews. */
    val subscription: Subscription? = null,
    /** What each plan includes, so the comparison always matches the server. */
    val plans: Plans? = null,
) {
    @Serializable
    data class Subscription(
        /** "apple" (bought in the iPhone app) or "stripe" (on the website); older servers leave it out. */
        val provider: String = "apple",
        val expiresAt: Long,
        /** Set while a failed renewal is retried: Hop+ carries on until this. */
        val graceExpiresAt: Long? = null,
        val autoRenew: Boolean,
    )

    @Serializable
    data class Plans(val free: Plan, val plus: Plan)

    @Serializable
    data class Plan(val storageBytes: Long, val retentionDays: Int? = null)

    @Serializable
    data class Storage(val usedBytes: Long, val limitBytes: Long)

    @Serializable
    data class Expiring(val clips: Int, val on: String, val at: Long)

    val isFree: Boolean get() = plan == "free"

    val usedFraction: Double
        get() = if (storage.limitBytes <= 0) 0.0 else storage.usedBytes.toDouble() / storage.limitBytes

    /** The free plan at 80% or more, as on the iPhone app. */
    val isNearlyFull: Boolean get() = isFree && usedFraction >= 0.8
    val isFull: Boolean get() = storage.usedBytes >= storage.limitBytes
}
