package com.onmyhop.app.core

import android.content.Context
import androidx.core.content.edit
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.serialization.Serializable

/**
 * The athlete's link as the widget and the Quick Settings tile show it.
 * Written by the app when the profile changes, and cleared when the athlete
 * signs out, so a widget never shows someone else's QR code.
 */
@Serializable
data class HopCard(
    /** onmyhop.com/<handle>, which the QR code encodes. */
    val link: String,
    val handle: String,
    val name: String? = null,
    /** A palette colour id. */
    val color: String,
) {
    companion object {
        private const val FILE = "hop.card"
        private const val KEY = "card"

        fun from(me: Me?): HopCard? {
            val handle = me?.handle ?: return null
            val link = me.link() ?: return null
            return HopCard(link = link.toString(), handle = handle, name = me.name, color = me.color)
        }

        fun load(context: Context): HopCard? =
            context.getSharedPreferences(FILE, Context.MODE_PRIVATE).getString(KEY, null)
                ?.let { runCatching { HopJson.decodeFromString(serializer(), it) }.getOrNull() }

        private val lock = Any()
        private var current: MutableStateFlow<HopCard?>? = null

        /** The card as it changes, for a widget to observe while it draws. */
        fun changes(context: Context): StateFlow<HopCard?> = synchronized(lock) {
            current ?: MutableStateFlow(load(context)).also { current = it }
        }

        /** Stores the card, or clears it with null. Returns whether anything changed. */
        fun save(context: Context, card: HopCard?): Boolean = synchronized(lock) {
            if (card == load(context)) return false
            context.getSharedPreferences(FILE, Context.MODE_PRIVATE).edit(commit = true) {
                if (card == null) remove(KEY) else putString(KEY, HopJson.encodeToString(serializer(), card))
            }
            (current ?: MutableStateFlow<HopCard?>(null).also { current = it }).value = card
            return true
        }
    }
}
