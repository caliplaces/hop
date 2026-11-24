package com.onmyhop.app.feature.inbox

import androidx.annotation.StringRes
import com.onmyhop.app.R

/** Why a clip was reported, as the API names it (REPORT_REASONS in packages/shared). */
enum class ReportReason(val id: String, @param:StringRes val label: Int) {
    Sexual("sexual", R.string.report_sexual),
    Violence("violence", R.string.report_violence),
    Harassment("harassment", R.string.report_harassment),
    Spam("spam", R.string.report_spam),
    Other("other", R.string.report_other),
}
