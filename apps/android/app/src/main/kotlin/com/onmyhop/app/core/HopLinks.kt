package com.onmyhop.app.core

import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.receiveAsFlow

/** Places the app can be asked to open from outside: a notification, a tile, a widget, a shortcut. */
sealed interface HopLink {
    /** Event mode's full-screen QR code. */
    data object EventStage : HopLink

    /** The athlete's QR code, full screen: Event mode's, if it's running. */
    data object QrCode : HopLink

    /** New clips: the event they're in, or the inbox when they're in several. */
    data class Clips(val hopId: String?) : HopLink

    /** Free-plan clips about to leave: the inbox, which says how many and when. */
    data object Expiring : HopLink
}

/** Links on their way to the signed-in app, which opens each once it's ready. */
class HopLinks {
    private val links = Channel<HopLink>(Channel.CONFLATED)
    val incoming = links.receiveAsFlow()

    fun open(link: HopLink) {
        links.trySend(link)
    }
}
