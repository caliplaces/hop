package com.onmyhop.app.feature.account

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.onmyhop.app.R
import com.onmyhop.app.auth.Session
import com.onmyhop.app.core.ApiError
import com.onmyhop.app.core.PlanStatus
import com.onmyhop.app.core.spoken
import com.onmyhop.app.design.BigButton
import com.onmyhop.app.design.SettingsGroup
import com.onmyhop.app.design.SettingsRow
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch

/** What to say about Hop+, which Apple keeps billing after the account goes. */
enum class BillingNote {
    /** Hop+ that will renew, from the App Store: it has to be cancelled with Apple. */
    Renews,

    /** Hop+ from the website: cancelled at once, with the account. */
    EndsWithAccount,

    /** The plan hasn't loaded, or couldn't: a paying athlete mustn't miss the warning. */
    Unknown,

    /** Free, or Hop+ that won't renew: nothing to cancel. */
    None;

    companion object {
        fun forPlan(status: PlanStatus?): BillingNote {
            status ?: return Unknown
            val subscription = status.subscription
            if (status.isFree || subscription == null) return None
            if (subscription.provider == "stripe") return EndsWithAccount
            return if (subscription.autoRenew) Renews else None
        }
    }
}

/**
 * Deleting the account: what goes and what stays, a word about Hop+, and a
 * confirmation. Once the server confirms, the app signs out.
 */
@Composable
fun DeleteAccountScreen(session: Session, plan: PlanStatus?, onBack: () -> Unit) {
    val state by session.state.collectAsStateWithLifecycle()
    val scope = rememberCoroutineScope()
    var confirming by remember { mutableStateOf(false) }
    var deleting by remember { mutableStateOf(false) }
    var failure by remember { mutableStateOf<String?>(null) }
    val offline = stringResource(R.string.offline)

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(stringResource(R.string.delete_account)) },
                navigationIcon = {
                    IconButton(onClick = onBack) { Icon(painterResource(R.drawable.ic_arrow_back), stringResource(R.string.back)) }
                },
            )
        },
    ) { padding ->
        Column(
            Modifier.fillMaxSize().padding(padding).verticalScroll(rememberScrollState()).padding(bottom = 24.dp),
            verticalArrangement = Arrangement.spacedBy(20.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Icon(
                painterResource(R.drawable.ic_account_circle),
                null,
                Modifier.padding(top = 16.dp).size(56.dp),
                tint = MaterialTheme.colorScheme.error,
            )
            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                Text(stringResource(R.string.delete_title), style = MaterialTheme.typography.headlineSmallEmphasized, textAlign = TextAlign.Center)
                Text(stringResource(R.string.delete_cant_undo), color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            SettingsGroup(
                title = stringResource(R.string.delete_what_happens),
                rows = buildList {
                    add(row(R.drawable.ic_movie, stringResource(R.string.delete_clips)))
                    add(row(R.drawable.ic_account_circle, stringResource(R.string.delete_profile)))
                    state.me?.link()?.let { add(row(R.drawable.ic_link, stringResource(R.string.delete_link, it.spoken))) }
                    add(row(R.drawable.ic_logout, stringResource(R.string.delete_signed_out)))
                },
            )
            val note = when (BillingNote.forPlan(plan)) {
                BillingNote.Renews -> R.string.delete_billing_renews
                BillingNote.EndsWithAccount -> R.string.delete_billing_ends
                BillingNote.Unknown -> R.string.delete_billing_unknown
                BillingNote.None -> null
            }
            if (note != null) SettingsGroup(title = "Hop+", rows = listOf(row(R.drawable.ic_open_in_new, stringResource(note))))
            Text(
                stringResource(R.string.delete_footnote),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                textAlign = TextAlign.Center,
                modifier = Modifier.padding(horizontal = 32.dp),
            )
            failure?.let {
                Text(it, color = MaterialTheme.colorScheme.error, textAlign = TextAlign.Center, modifier = Modifier.padding(horizontal = 32.dp))
            }
            BigButton(
                text = stringResource(R.string.delete_account),
                onClick = { confirming = true },
                working = deleting,
                modifier = Modifier.padding(horizontal = 24.dp).fillMaxWidth(),
                colors = ButtonDefaults.buttonColors(
                    containerColor = MaterialTheme.colorScheme.error,
                    contentColor = MaterialTheme.colorScheme.onError,
                ),
            )
        }
    }

    if (confirming) {
        AlertDialog(
            onDismissRequest = { confirming = false },
            title = { Text(stringResource(R.string.delete_title)) },
            text = { Text(stringResource(R.string.delete_confirm_message)) },
            confirmButton = {
                TextButton(onClick = {
                    confirming = false
                    deleting = true
                    failure = null
                    scope.launch {
                        try {
                            // Signs out once the server confirms; the app moves to the welcome screen.
                            session.deleteAccount()
                        } catch (error: CancellationException) {
                            throw error
                        } catch (error: Exception) {
                            failure = (error as? ApiError)?.message ?: offline
                        } finally {
                            deleting = false
                        }
                    }
                }) { Text(stringResource(R.string.delete_account), color = MaterialTheme.colorScheme.error) }
            },
            dismissButton = { TextButton(onClick = { confirming = false }) { Text(stringResource(R.string.cancel)) } },
        )
    }
}

private fun row(icon: Int, text: String) = SettingsRow(onClick = null, leading = { Icon(painterResource(icon), null) }) { Text(text) }
