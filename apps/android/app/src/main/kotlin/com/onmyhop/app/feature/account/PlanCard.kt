package com.onmyhop.app.feature.account

import android.text.format.DateFormat
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.LinearWavyProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import com.onmyhop.app.R
import com.onmyhop.app.core.PlanStatus
import com.onmyhop.app.core.storageText
import com.onmyhop.app.design.athlete
import java.util.Date

/**
 * The athlete's plan: Free or Hop+, the storage used, how long clips are
 * kept, and with Hop+, when it renews or ends and where it's managed. Hop+
 * isn't sold in the Android app yet.
 */
@Composable
fun PlanCard(status: PlanStatus, modifier: Modifier = Modifier) {
    val context = LocalContext.current
    val used = storageText(status.storage.usedBytes)
    val limit = storageText(status.storage.limitBytes)
    val storageText = stringResource(R.string.plan_storage, used, limit)
    val warning = status.isFree && status.usedFraction >= 0.8
    Card(
        modifier.fillMaxWidth().padding(horizontal = 16.dp),
        shape = MaterialTheme.shapes.extraLarge,
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainer),
    ) {
        Column(Modifier.padding(20.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    if (status.isFree) stringResource(R.string.plan_free) else "Hop+",
                    style = MaterialTheme.typography.titleLargeEmphasized,
                    color = if (status.isFree) MaterialTheme.colorScheme.onSurface else MaterialTheme.athlete.color,
                    modifier = Modifier.weight(1f),
                )
                Text(storageText, style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            LinearWavyProgressIndicator(
                progress = { status.usedFraction.toFloat().coerceIn(0f, 1f) },
                color = if (warning) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.primary,
                modifier = Modifier.fillMaxWidth().semantics { contentDescription = storageText },
            )
            Detail(
                R.drawable.ic_hourglass_bottom,
                status.retentionDays?.let { pluralStringResource(R.plurals.plan_kept_days, it, it) }
                    ?: stringResource(R.string.plan_kept_for_good),
            )
            status.subscription?.let { subscription ->
                val now = System.currentTimeMillis()
                val grace = subscription.graceExpiresAt?.takeIf { it > now && subscription.expiresAt <= now }
                val date = { at: Long -> DateFormat.getMediumDateFormat(context).format(Date(at)) }
                when {
                    grace != null -> Detail(R.drawable.ic_error, stringResource(R.string.plan_grace, date(grace)), warning = true)
                    subscription.autoRenew -> Detail(R.drawable.ic_refresh, stringResource(R.string.plan_renews, date(subscription.expiresAt)))
                    else -> Detail(R.drawable.ic_hourglass_bottom, stringResource(R.string.plan_ends, date(subscription.expiresAt)))
                }
                Detail(
                    R.drawable.ic_open_in_new,
                    stringResource(if (subscription.provider == "stripe") R.string.plan_managed_website else R.string.plan_managed_app_store),
                )
            }
        }
    }
}

@Composable
private fun Detail(icon: Int, text: String, warning: Boolean = false) {
    val color = if (warning) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurfaceVariant
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        Icon(painterResource(icon), null, Modifier.size(18.dp), tint = color)
        Text(text, style = MaterialTheme.typography.bodyMedium, color = color)
    }
}
