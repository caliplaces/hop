package com.onmyhop.app.core

import java.util.Locale

/**
 * Storage as people read it on Hop: "15 GB", counted in 1024s like the plans,
 * the website and the iPhone app (Android's own formatter counts in 1000s,
 * which would make the free plan's 15 GB read as 16).
 */
fun storageText(bytes: Long, locale: Locale = Locale.getDefault()): String {
    if (bytes < 1024) return "$bytes B"
    val units = listOf("KB", "MB", "GB", "TB")
    var value = bytes / 1024.0
    var unit = 0
    while (value >= 1024 && unit < units.lastIndex) {
        value /= 1024
        unit++
    }
    val number = if (value < 10 && value % 1.0 > 0.05) String.format(locale, "%.1f", value) else String.format(locale, "%.0f", value)
    return "$number ${units[unit]}"
}
