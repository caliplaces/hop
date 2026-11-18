package com.onmyhop.app.core

import com.onmyhop.app.BuildConfig
import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull

/**
 * Where Hop's API lives. Release builds use production. Debug builds use
 * staging, or the server named by the `hop.apiUrl` Gradle property, such as
 * `wrangler dev` on this computer (see the README).
 */
object HopServer {
    val baseUrl: HttpUrl by lazy {
        BuildConfig.API_URL.toHttpUrlOrNull()?.takeIf { isAllowed(it) }
            ?: error("API_URL must be https, or plain http to this computer: ${BuildConfig.API_URL}")
    }

    /** Hosts the emulator or a USB-connected phone reaches this computer on. */
    private val localHosts = setOf("127.0.0.1", "localhost", "10.0.2.2")

    /** https anywhere, or plain http to this computer only. */
    fun isAllowed(url: HttpUrl): Boolean = when (url.scheme) {
        "https" -> true
        "http" -> url.host in localHosts
        else -> false
    }

    /**
     * Names a server for storing its token: scheme, host and port, so two
     * local servers on different ports never share a sign-in.
     */
    fun storageKey(url: HttpUrl): String = "${url.scheme}://${url.host}:${url.port}"

    /**
     * The custom scheme Caliplaces redirects to after sign-in where the
     * https callback isn't in use (staging). It matches the package name.
     */
    const val CALLBACK_SCHEME = "com.onmyhop.app"

    /**
     * Whether sign-in may come back through the custom scheme. Any app can
     * claim a scheme, and pose as Hop with it, so only debug builds (which
     * talk to staging) accept it. Release builds only take the https
     * callback, which Chrome checks belongs to this app.
     */
    val ALLOWS_CUSTOM_SCHEME: Boolean = BuildConfig.DEBUG
}
