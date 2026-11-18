package com.onmyhop.app.feature.event

import android.Manifest
import android.content.pm.PackageManager
import android.os.Build
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.RadioButton
import androidx.compose.material3.SheetValue
import androidx.compose.material3.Text
import androidx.compose.material3.rememberBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import com.onmyhop.app.R
import com.onmyhop.app.auth.Session
import com.onmyhop.app.core.ApiError
import com.onmyhop.app.core.Hop
import com.onmyhop.app.design.BigButton
import com.onmyhop.app.design.Bobble
import com.onmyhop.app.design.athlete
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle

/**
 * Starting Event mode: where the clips go (the event the link uploads to
 * now, if it's from today, or a new one by name), then Go live.
 */
@Composable
fun EventSetupSheet(
    session: Session,
    eventMode: EventMode,
    hops: List<Hop>,
    onStarted: () -> Unit,
    onDismiss: () -> Unit,
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val sheet = rememberBottomSheetState(SheetValue.Hidden, enabledValues = setOf(SheetValue.Hidden, SheetValue.Expanded))
    val me = session.me
    // The event the link uploads to now, unless it's closed.
    val live = hops.firstOrNull { it.id == me?.activeHopId && !it.isClosed }
    val liveToday = live != null &&
        Instant.ofEpochMilli(live.createdAt).atZone(ZoneId.systemDefault()).toLocalDate() == LocalDate.now()
    var useLive by rememberSaveable { mutableStateOf(liveToday) }
    var title by rememberSaveable { mutableStateOf("") }
    var starting by remember { mutableStateOf(false) }
    var problem by remember { mutableStateOf<String?>(null) }
    val defaultTitle = remember { LocalDate.now().format(DateTimeFormatter.ofLocalizedDate(FormatStyle.FULL)) }
    val offline = stringResource(R.string.offline)

    fun goLive() {
        if (starting || me == null) return
        val target = if (useLive && live != null) {
            EventMode.Target.Existing(live)
        } else {
            EventMode.Target.NewEvent(title.trim().ifEmpty { defaultTitle })
        }
        starting = true
        problem = null
        scope.launch {
            try {
                eventMode.start(target, me, session.api)
                onStarted()
            } catch (error: CancellationException) {
                throw error
            } catch (error: Exception) {
                problem = (error as? ApiError)?.message ?: offline
            } finally {
                starting = false
            }
        }
    }

    // The count in a notification needs permission on Android 13+: asked once, here.
    val askForNotifications = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { goLive() }
    fun start() {
        val needsAsking = Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        if (needsAsking) askForNotifications.launch(Manifest.permission.POST_NOTIFICATIONS) else goLive()
    }

    ModalBottomSheet(onDismissRequest = { if (!starting) onDismiss() }, sheetState = sheet) {
        Column(
            Modifier.verticalScroll(rememberScrollState()).padding(horizontal = 24.dp).padding(bottom = 24.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Bobble(MaterialTheme.athlete, Modifier.size(96.dp))
            Text(stringResource(R.string.event_mode), style = MaterialTheme.typography.headlineSmallEmphasized)
            Text(
                stringResource(R.string.event_setup_message),
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                textAlign = TextAlign.Center,
            )
            Text(
                stringResource(R.string.event_clips_go_to),
                style = MaterialTheme.typography.titleSmall,
                color = MaterialTheme.colorScheme.primary,
                modifier = Modifier.fillMaxWidth().padding(top = 8.dp),
            )
            Column(Modifier.selectableGroup()) {
                if (live != null) {
                    Option(selected = useLive, onSelect = { useLive = true }) {
                        Text(live.title, style = MaterialTheme.typography.bodyLarge)
                        Text(
                            stringResource(R.string.event_live_now, pluralStringResource(R.plurals.clip_count, live.fileCount, live.fileCount)),
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                }
                Option(selected = !useLive || live == null, onSelect = { useLive = false }) {
                    Text(stringResource(R.string.event_new), style = MaterialTheme.typography.bodyLarge)
                }
            }
            AnimatedVisibility(!useLive || live == null) {
                OutlinedTextField(
                    value = title,
                    onValueChange = { title = it.take(80) },
                    label = { Text(stringResource(R.string.event_name)) },
                    placeholder = { Text(defaultTitle) },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                    keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Words, imeAction = ImeAction.Go),
                    keyboardActions = KeyboardActions(onGo = { start() }),
                )
            }
            AnimatedVisibility(problem != null) {
                Text(problem.orEmpty(), color = MaterialTheme.colorScheme.error, textAlign = TextAlign.Center)
            }
            BigButton(
                text = stringResource(R.string.event_go_live),
                onClick = ::start,
                working = starting,
                athlete = MaterialTheme.athlete,
                modifier = Modifier.padding(top = 8.dp),
            )
        }
    }
}

@Composable
private fun Option(selected: Boolean, onSelect: () -> Unit, content: @Composable () -> Unit) {
    Row(
        Modifier
            .fillMaxWidth()
            .selectable(selected = selected, role = Role.RadioButton, onClick = onSelect)
            .padding(vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        RadioButton(selected = selected, onClick = null)
        Column { content() }
    }
}
