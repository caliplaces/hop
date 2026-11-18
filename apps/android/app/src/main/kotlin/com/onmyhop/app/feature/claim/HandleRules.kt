package com.onmyhop.app.feature.claim

/**
 * What makes a handle (onmyhop.com/<handle>) acceptable before asking the
 * server, mirrored from packages/shared/src/handles.ts. The server also
 * rejects reserved and taken handles. `HandleRulesTest` keeps the pattern in
 * sync with the website's.
 */
object HandleRules {
    /** The website's `HANDLE_PATTERN`, character for character. */
    const val PATTERN = "^[a-z0-9][a-z0-9_.]{0,28}[a-z0-9]$"
    private val regex = Regex(PATTERN)

    /** Trims, drops a leading "@" and lowercases, as the server does. */
    fun normalize(input: String): String = input.trim().removePrefix("@").lowercase()

    fun isValid(handle: String): Boolean = regex.matches(handle) && ".." !in handle

    /** A first guess from their name or email, like the website's. */
    fun suggestion(name: String?, email: String?): String {
        val base = name ?: email?.substringBefore("@") ?: ""
        val handle = normalize(base.filterNot { it.isWhitespace() })
        return handle.filter { it in "abcdefghijklmnopqrstuvwxyz0123456789_." }.take(30)
    }
}
