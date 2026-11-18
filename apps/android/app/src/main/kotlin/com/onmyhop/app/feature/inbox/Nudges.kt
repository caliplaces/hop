package com.onmyhop.app.feature.inbox

import android.text.format.Formatter
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.LinearWavyProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import com.onmyhop.app.R
import com.onmyhop.app.core.PlanStatus
import java.time.LocalDate
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle
import kotlin.math.roundToInt

/**
 * Free-plan clips about to leave: how many, and the day, read in the
 * phone's calendar ("today", "tomorrow", or the date).
 */
@Composable
fun ExpiryNudge(expiring: PlanStatus.Expiring) {
    val day = remember(expiring.on) { runCatching { LocalDate.parse(expiring.on) }.getOrNull() }
    val today = LocalDate.now(ZoneId.systemDefault())
    val title = when {
        day == null -> pluralStringResource(R.plurals.expiry_soon, expiring.clips, expiring.clips)
        // Clips stay until the day has ended everywhere, so it can already be past here.
        !day.isAfter(today) -> pluralStringResource(R.plurals.expiry_today, expiring.clips, expiring.clips)
        day == today.plusDays(1) -> pluralStringResource(R.plurals.expiry_tomorrow, expiring.clips, expiring.clips)
        else -> pluralStringResource(
            R.plurals.expiry_on,
            expiring.clips,
            expiring.clips,
            day.format(DateTimeFormatter.ofLocalizedDate(FormatStyle.LONG)),
        )
    }
    Nudge(icon = R.drawable.ic_hourglass_bottom, title = title, detail = stringResource(R.string.expiry_detail), warning = true)
}

/** The free plan at 80% or more. */
@Composable
fun StorageNudge(plan: PlanStatus) {
    val context = LocalContext.current
    val title = if (plan.isFull) {
        stringResource(R.string.storage_full)
    } else {
        stringResource(R.string.storage_nearly_full, (plan.usedFraction * 100).roundToInt())
    }
    val detail = stringResource(
        if (plan.isFull) R.string.storage_full_detail else R.string.storage_nearly_full_detail,
        Formatter.formatShortFileSize(context, plan.storage.usedBytes),
        Formatter.formatShortFileSize(context, plan.storage.limitBytes),
    )
    Nudge(icon = R.drawable.ic_cloud, title = title, detail = detail, warning = plan.isFull) {
        LinearWavyProgressIndicator(
            progress = { plan.usedFraction.toFloat().coerceIn(0f, 1f) },
            modifier = Modifier.fillMaxWidth().padding(top = 12.dp),
        )
    }
}

@Composable
private fun Nudge(icon: Int, title: String, detail: String, warning: Boolean, extra: @Composable () -> Unit = {}) {
    val colors = if (warning) {
        CardDefaults.cardColors(
            containerColor = MaterialTheme.colorScheme.errorContainer,
            contentColor = MaterialTheme.colorScheme.onErrorContainer,
        )
    } else {
        CardDefaults.cardColors(
            containerColor = MaterialTheme.colorScheme.secondaryContainer,
            contentColor = MaterialTheme.colorScheme.onSecondaryContainer,
        )
    }
    Card(Modifier.fillMaxWidth(), shape = MaterialTheme.shapes.extraLarge, colors = colors) {
        Column(Modifier.padding(20.dp)) {
            Row(verticalAlignment = Alignment.Top, horizontalArrangement = Arrangement.spacedBy(14.dp)) {
                Icon(painterResource(icon), contentDescription = null)
                Column {
                    Text(title, style = MaterialTheme.typography.titleMediumEmphasized)
                    Text(detail, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.padding(top = 2.dp))
                }
            }
            extra()
        }
    }
}
