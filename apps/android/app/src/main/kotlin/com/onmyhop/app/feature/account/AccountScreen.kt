package com.onmyhop.app.feature.account

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.onmyhop.app.R
import com.onmyhop.app.push.Push
import com.onmyhop.app.push.rememberNotificationsPermission
import com.onmyhop.app.auth.Session
import com.onmyhop.app.core.ApiError
import com.onmyhop.app.core.Me
import com.onmyhop.app.core.spoken
import com.onmyhop.app.design.Avatar
import com.onmyhop.app.design.HopLegal
import com.onmyhop.app.design.SettingsGroup
import com.onmyhop.app.design.SettingsRow
import com.onmyhop.app.design.settingsRowColors
import com.onmyhop.app.feature.inbox.InboxModel
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch
import kotlinx.serialization.Serializable

/**
 * The athlete's account: their profile, plan and storage, new-clip emails,
 * blocked senders, Hop's legal pages, signing out and deleting the account.
 */
@Composable
fun AccountScreen(
    session: Session,
    inbox: InboxModel,
    push: Push,
    onBack: () -> Unit,
    openProfile: () -> Unit,
    openBlocked: () -> Unit,
    openDelete: () -> Unit,
) {
    val state by session.state.collectAsStateWithLifecycle()
    val me = state.me
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val snackbar = remember { SnackbarHostState() }
    val offline = stringResource(R.string.offline)
    var saving by remember { mutableStateOf(false) }
    val notifications = rememberNotificationsPermission(push)

    // The plan moves while the app is away (storage, renewals).
    LaunchedEffect(Unit) { inbox.refreshPlan() }

    /** One setting at a time: the switches wait while a change is on its way. */
    fun save(change: NewClipsChange) {
        val token = session.token
        saving = true
        scope.launch {
            try {
                val reply: MeReply = session.client(token).patch("api/me", change)
                session.update(reply.me, token)
            } catch (error: CancellationException) {
                throw error
            } catch (error: Exception) {
                snackbar.showSnackbar((error as? ApiError)?.message ?: offline)
            } finally {
                saving = false
            }
        }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(stringResource(R.string.account_title)) },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(painterResource(R.drawable.ic_arrow_back), stringResource(R.string.back))
                    }
                },
            )
        },
        snackbarHost = { SnackbarHost(snackbar) },
    ) { padding ->
        Column(
            Modifier.fillMaxSize().padding(padding).verticalScroll(rememberScrollState()).padding(bottom = 24.dp),
            verticalArrangement = Arrangement.spacedBy(20.dp),
        ) {
            if (me != null) {
                SettingsGroup(
                    listOf(
                        SettingsRow(
                            onClick = openProfile,
                            leading = { Avatar(me, 56.dp) },
                            supporting = me.link()?.let { link -> { Text(link.spoken) } },
                            trailing = { Icon(painterResource(R.drawable.ic_edit), stringResource(R.string.profile_edit_title)) },
                        ) {
                            Text(
                                me.name ?: me.email ?: stringResource(R.string.account_signed_in),
                                style = MaterialTheme.typography.titleMedium,
                            )
                        },
                    ),
                )
            }
            inbox.plan?.let { PlanCard(it) }
            if (me != null) {
                SettingsGroup(
                    title = stringResource(R.string.account_new_clips),
                    rows = buildList {
                        if (push.isAvailable) {
                            add(
                                SettingsRow(
                                    onClick = { if (!saving) save(NewClipsChange(pushNewClips = !me.pushNewClips)) },
                                    trailing = { Switch(checked = me.pushNewClips, onCheckedChange = null, enabled = !saving) },
                                ) { Text(stringResource(R.string.account_new_clips_push)) },
                            )
                            // Wanted, but not allowed on this phone.
                            if (me.pushNewClips && !notifications.allowed) {
                                add(
                                    SettingsRow(
                                        onClick = notifications.ask,
                                        leading = { Icon(painterResource(R.drawable.ic_notifications), null) },
                                        supporting = { Text(stringResource(R.string.account_new_clips_push_off)) },
                                    ) { Text(stringResource(R.string.account_new_clips_push_allow)) },
                                )
                            }
                        }
                        add(
                            SettingsRow(
                                onClick = { if (!saving) save(NewClipsChange(emailNewClips = !me.emailNewClips)) },
                                supporting = { Text(stringResource(R.string.account_new_clips_email_detail, me.email ?: "")) },
                                trailing = { Switch(checked = me.emailNewClips, onCheckedChange = null, enabled = !saving) },
                            ) { Text(stringResource(R.string.account_new_clips_email)) },
                        )
                    },
                )
            }
            SettingsGroup(
                listOf(
                    SettingsRow(
                        onClick = openBlocked,
                        leading = { Icon(painterResource(R.drawable.ic_block), null) },
                        trailing = { Icon(painterResource(R.drawable.ic_chevron_right), null) },
                    ) { Text(stringResource(R.string.blocked_title)) },
                ),
            )
            SettingsGroup(
                listOf(
                    SettingsRow(
                        onClick = { HopLegal.open(context, HopLegal.PRIVACY) },
                        trailing = { Icon(painterResource(R.drawable.ic_open_in_new), null) },
                    ) { Text(stringResource(R.string.account_privacy)) },
                    SettingsRow(
                        onClick = { HopLegal.open(context, HopLegal.TERMS) },
                        trailing = { Icon(painterResource(R.drawable.ic_open_in_new), null) },
                    ) { Text(stringResource(R.string.account_terms)) },
                ),
            )
            SettingsGroup(
                listOf(
                    SettingsRow(
                        onClick = { session.signOut() },
                        leading = { Icon(painterResource(R.drawable.ic_logout), null) },
                        colors = { settingsRowColors(MaterialTheme.colorScheme.error) },
                    ) { Text(stringResource(R.string.sign_out)) },
                    SettingsRow(
                        onClick = openDelete,
                        colors = { settingsRowColors(MaterialTheme.colorScheme.error) },
                    ) { Text(stringResource(R.string.delete_account)) },
                ),
            )
        }
    }
}

/** Only the setting that changed; the other is left out. */
@Serializable
private class NewClipsChange(val pushNewClips: Boolean? = null, val emailNewClips: Boolean? = null)

@Serializable
private class MeReply(val me: Me)

/** An overflow menu with Sign out, for screens before the app proper (claiming a handle). */
@Composable
fun SignOutMenu(session: Session) {
    var open by remember { mutableStateOf(false) }
    IconButton(onClick = { open = true }) {
        Icon(painterResource(R.drawable.ic_account_circle), stringResource(R.string.account_title))
    }
    DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
        DropdownMenuItem(
            text = { Text(stringResource(R.string.sign_out)) },
            leadingIcon = { Icon(painterResource(R.drawable.ic_logout), null) },
            onClick = {
                open = false
                session.signOut()
            },
        )
    }
}
