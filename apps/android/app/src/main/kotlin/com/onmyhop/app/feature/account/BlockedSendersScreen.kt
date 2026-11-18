package com.onmyhop.app.feature.account

import android.text.format.DateUtils
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LoadingIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
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
import com.onmyhop.app.R
import com.onmyhop.app.auth.Session
import com.onmyhop.app.core.ApiError
import com.onmyhop.app.design.SettingsGroup
import com.onmyhop.app.design.SettingsRow
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch
import kotlinx.serialization.Serializable

/** Someone the athlete blocked, as `GET /api/me/blocks` lists them. */
@Serializable
data class BlockedSender(
    val id: String,
    /** How they appeared on the clip blocked: a name or an @handle. */
    val label: String? = null,
    val createdAt: Long,
)

@Serializable
private class BlocksReply(val blocks: List<BlockedSender>)

/**
 * The senders the athlete blocked, newest first. Unblocking lets them send
 * clips again; the clips that went with the block don't come back.
 */
@Composable
fun BlockedSendersScreen(session: Session, onBack: () -> Unit) {
    val scope = rememberCoroutineScope()
    val snackbar = remember { SnackbarHostState() }
    var senders by remember { mutableStateOf<List<BlockedSender>?>(null) }
    var failed by remember { mutableStateOf(false) }
    var attempt by remember { mutableIntStateOf(0) }
    val offline = stringResource(R.string.offline)

    LaunchedEffect(attempt) {
        failed = false
        try {
            senders = session.api.get<BlocksReply>("api/me/blocks").blocks
        } catch (error: CancellationException) {
            throw error
        } catch (_: Exception) {
            failed = true
        }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(stringResource(R.string.blocked_title)) },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(painterResource(R.drawable.ic_arrow_back), stringResource(R.string.back))
                    }
                },
            )
        },
        snackbarHost = { SnackbarHost(snackbar) },
    ) { padding ->
        val list = senders
        Box(Modifier.fillMaxSize().padding(padding), contentAlignment = Alignment.TopCenter) {
            when {
                list == null && failed -> Column(Modifier.padding(32.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                    Text(offline, color = MaterialTheme.colorScheme.onSurfaceVariant, textAlign = TextAlign.Center)
                    OutlinedButton(onClick = { attempt++ }, Modifier.padding(top = 12.dp)) { Text(stringResource(R.string.try_again)) }
                }
                list == null -> LoadingIndicator(Modifier.padding(top = 96.dp).size(56.dp))
                list.isEmpty() -> Column(Modifier.padding(32.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                    Icon(painterResource(R.drawable.ic_block), null, Modifier.size(40.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
                    Text(stringResource(R.string.blocked_empty), style = MaterialTheme.typography.titleMedium, modifier = Modifier.padding(top = 12.dp))
                    Text(
                        stringResource(R.string.blocked_empty_message),
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        textAlign = TextAlign.Center,
                        modifier = Modifier.padding(top = 4.dp),
                    )
                }
                else -> Column(Modifier.verticalScroll(rememberScrollState()).padding(vertical = 8.dp)) {
                    SettingsGroup(
                        list.map { sender ->
                            SettingsRow(
                                onClick = null,
                                leading = { Icon(painterResource(R.drawable.ic_block), null) },
                                supporting = { Text(DateUtils.getRelativeTimeSpanString(sender.createdAt).toString()) },
                                trailing = {
                                    TextButton(onClick = {
                                        scope.launch {
                                            try {
                                                session.api.delete("api/me/blocks/${sender.id}")
                                                senders = senders?.filterNot { it.id == sender.id }
                                            } catch (error: CancellationException) {
                                                throw error
                                            } catch (error: Exception) {
                                                snackbar.showSnackbar((error as? ApiError)?.message ?: offline)
                                            }
                                        }
                                    }) { Text(stringResource(R.string.unblock)) }
                                },
                            ) { Text(sender.label ?: stringResource(R.string.someone)) }
                        },
                    )
                    Text(
                        stringResource(R.string.blocked_footnote),
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.padding(horizontal = 32.dp, vertical = 12.dp),
                    )
                }
            }
        }
    }
}
