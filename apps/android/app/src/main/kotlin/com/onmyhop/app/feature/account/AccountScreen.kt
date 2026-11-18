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
import androidx.compose.material3.ListItemDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
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
import com.onmyhop.app.auth.Session
import com.onmyhop.app.core.spoken
import com.onmyhop.app.design.Avatar
import com.onmyhop.app.design.HopLegal
import com.onmyhop.app.design.SettingsGroup
import com.onmyhop.app.design.SettingsRow
import kotlinx.coroutines.launch

/** The athlete's account: who they are, Hop's legal pages, and signing out. */
@Composable
fun AccountScreen(session: Session, onBack: () -> Unit) {
    val state by session.state.collectAsStateWithLifecycle()
    val me = state.me
    val context = LocalContext.current
    val scope = rememberCoroutineScope()

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
    ) { padding ->
        Column(
            Modifier.fillMaxSize().padding(padding).verticalScroll(rememberScrollState()).padding(bottom = 24.dp),
            verticalArrangement = Arrangement.spacedBy(20.dp),
        ) {
            if (me != null) {
                SettingsGroup(
                    listOf(
                        SettingsRow(
                            onClick = null,
                            leading = { Avatar(me, 56.dp) },
                            supporting = me.link()?.let { link -> { Text(link.spoken) } },
                        ) {
                            Text(
                                me.name ?: me.email ?: stringResource(R.string.account_signed_in),
                                style = MaterialTheme.typography.titleMedium,
                            )
                        },
                    ),
                )
            }
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
                        onClick = { scope.launch { session.signOut() } },
                        leading = { Icon(painterResource(R.drawable.ic_logout), null) },
                        colors = {
                            ListItemDefaults.segmentedColors(
                                contentColor = MaterialTheme.colorScheme.error,
                                leadingContentColor = MaterialTheme.colorScheme.error,
                            )
                        },
                    ) { Text(stringResource(R.string.sign_out)) },
                ),
            )
        }
    }
}

/** An overflow menu with Sign out, for screens before the app proper (claiming a handle). */
@Composable
fun SignOutMenu(session: Session) {
    var open by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    IconButton(onClick = { open = true }) {
        Icon(painterResource(R.drawable.ic_account_circle), stringResource(R.string.account_title))
    }
    DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
        DropdownMenuItem(
            text = { Text(stringResource(R.string.sign_out)) },
            leadingIcon = { Icon(painterResource(R.drawable.ic_logout), null) },
            onClick = {
                open = false
                scope.launch { session.signOut() }
            },
        )
    }
}
