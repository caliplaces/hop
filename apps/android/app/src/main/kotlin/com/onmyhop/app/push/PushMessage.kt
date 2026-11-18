package com.onmyhop.app.push

import kotlinx.serialization.Serializable
import java.security.MessageDigest
import java.util.Base64

/**
 * This install's push token, as the API has it, and whose it is: the
 * athlete signed in when it was sent.
 */
@Serializable
data class Registration(val userId: String, val token: String) {
    /** How the API says a message is for this athlete on this phone. */
    val recipient: String get() = recipient(userId, token)

    override fun toString() = "Registration(userId=$userId)"

    companion object {
        /**
         * The first 22 characters of base64url(SHA-256("<user id>:<token>")),
         * as the API works it out (apps/api/src/lib/fcm.ts).
         */
        fun recipient(userId: String, token: String): String {
            val digest = MessageDigest.getInstance("SHA-256").digest("$userId:$token".toByteArray())
            return Base64.getUrlEncoder().withoutPadding().encodeToString(digest).take(22)
        }
    }
}

/** What a push from Hop's API is about (see "Android pushes" in apps/api/README.md). */
sealed interface PushMessage {
    /** New clips: in one event, or in several. Notifications of one event are grouped together. */
    data class Clips(val hopId: String?, val title: String, val body: String, val group: String?) : PushMessage

    /** Free-plan clips about to leave. Each notice replaces the one before it. */
    data class Expiring(val title: String, val body: String, val tag: String?) : PushMessage

    /**
     * Event mode's count: clips since it started, and who sent the latest, as
     * of `at` (server clock). `since` is the run it counts for, when the API
     * says.
     */
    data class Event(val hopId: String, val since: Long?, val clips: Int, val latest: String?, val at: Long) : PushMessage

    companion object {
        /**
         * The message in a push's data, if it's for [registration]: the
         * athlete signed in here, with this install's token. Null for
         * anything else, such as a message for an account that has signed
         * out of this phone since (its sign-out never reached the API).
         */
        fun parse(data: Map<String, String>, registration: Registration?): PushMessage? {
            if (registration == null || data["recipient"] != registration.recipient) return null
            return when (data["hop"]) {
                "clips" -> Clips(
                    hopId = data["hopId"],
                    title = data["title"] ?: return null,
                    body = data["body"] ?: return null,
                    group = data["group"],
                )
                "expiring" -> Expiring(
                    title = data["title"] ?: return null,
                    body = data["body"] ?: return null,
                    tag = data["tag"],
                )
                "event" -> Event(
                    hopId = data["hopId"] ?: return null,
                    since = data["since"]?.toLongOrNull(),
                    clips = data["clips"]?.toIntOrNull()?.takeIf { it >= 0 } ?: return null,
                    latest = data["latest"],
                    at = data["at"]?.toLongOrNull() ?: return null,
                )
                else -> null
            }
        }
    }
}
