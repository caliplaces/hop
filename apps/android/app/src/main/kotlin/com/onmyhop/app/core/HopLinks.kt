package com.onmyhop.app.core

import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.receiveAsFlow

/** Places the app can be asked to open from outside: a notification, a tile, a widget, a shortcut. */
enum class HopLink {
    /** Event mode's full-screen QR code. */
    EventStage,

    /** The athlete's QR code, full screen: Event mode's, if it's running. */
    QrCode,
}

/** Links on their way to the signed-in app, which opens each once it's ready. */
class HopLinks {
    private val links = Channel<HopLink>(Channel.CONFLATED)
    val incoming = links.receiveAsFlow()

    fun open(link: HopLink) {
        links.trySend(link)
    }
}
