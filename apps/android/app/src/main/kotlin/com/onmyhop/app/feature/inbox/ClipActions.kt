package com.onmyhop.app.feature.inbox

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.foundation.selection.toggleable
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularWavyProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.FloatingToolbarDefaults
import androidx.compose.material3.HorizontalFloatingToolbar
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.SheetValue
import androidx.compose.material3.rememberBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.unit.dp
import com.onmyhop.app.R
import com.onmyhop.app.core.Clip
import com.onmyhop.app.design.BigButton

/** What can be done with the clip on screen: save it, share it, and more. */
@Composable
fun ClipToolbar(
    clip: Clip,
    transfer: ClipTransfers.Transfer?,
    onSave: () -> Unit,
    onShare: () -> Unit,
    onReport: () -> Unit,
    onBlock: () -> Unit,
    onDelete: () -> Unit,
    modifier: Modifier = Modifier,
) {
    var menu by remember { mutableStateOf(false) }
    val busy = transfer?.isBusy == true
    val mine = transfer?.takeIf { it.clipId == clip.id }
    val sender = clip.contributorName ?: stringResource(R.string.someone)
    HorizontalFloatingToolbar(
        expanded = true,
        modifier = modifier.navigationBarsPadding().padding(bottom = 16.dp),
        colors = FloatingToolbarDefaults.standardFloatingToolbarColors(),
    ) {
        TransferButton(
            kind = ClipTransfers.Kind.Save,
            transfer = mine,
            icon = R.drawable.ic_download,
            label = R.string.clip_save,
            enabled = !busy,
            onClick = onSave,
        )
        TransferButton(
            kind = ClipTransfers.Kind.Share,
            transfer = mine,
            icon = R.drawable.ic_share,
            label = R.string.share,
            enabled = !busy,
            onClick = onShare,
        )
        Box {
            IconButton(onClick = { menu = true }) {
                Icon(painterResource(R.drawable.ic_more_vert), stringResource(R.string.more))
            }
            DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
                DropdownMenuItem(
                    text = { Text(stringResource(R.string.clip_report)) },
                    leadingIcon = { Icon(painterResource(R.drawable.ic_flag), null) },
                    onClick = {
                        menu = false
                        onReport()
                    },
                )
                DropdownMenuItem(
                    text = { Text(stringResource(R.string.clip_block, sender)) },
                    leadingIcon = { Icon(painterResource(R.drawable.ic_block), null) },
                    onClick = {
                        menu = false
                        onBlock()
                    },
                )
                DropdownMenuItem(
                    text = { Text(stringResource(R.string.clip_delete), color = MaterialTheme.colorScheme.error) },
                    leadingIcon = { Icon(painterResource(R.drawable.ic_delete), null, tint = MaterialTheme.colorScheme.error) },
                    onClick = {
                        menu = false
                        onDelete()
                    },
                )
            }
        }
    }
}

/** Save or Share, showing its download's progress while it runs. */
@Composable
private fun TransferButton(
    kind: ClipTransfers.Kind,
    transfer: ClipTransfers.Transfer?,
    icon: Int,
    label: Int,
    enabled: Boolean,
    onClick: () -> Unit,
) {
    val phase = transfer?.takeIf { it.kind == kind }?.phase
    IconButton(onClick = onClick, enabled = enabled) {
        when (phase) {
            is ClipTransfers.Phase.Downloading -> {
                val fraction = phase.fraction
                if (fraction != null) {
                    CircularWavyProgressIndicator(progress = { fraction }, modifier = Modifier.size(28.dp))
                } else {
                    CircularWavyProgressIndicator(modifier = Modifier.size(28.dp))
                }
            }
            is ClipTransfers.Phase.Done -> Icon(painterResource(R.drawable.ic_check), stringResource(label))
            else -> Icon(painterResource(icon), stringResource(label))
        }
    }
}

/** Deleting is for good: asks first. */
@Composable
fun ConfirmDeleteDialog(onConfirm: () -> Unit, onDismiss: () -> Unit) {
    AlertDialog(
        onDismissRequest = onDismiss,
        icon = { Icon(painterResource(R.drawable.ic_delete), null) },
        title = { Text(stringResource(R.string.clip_delete_title)) },
        text = { Text(stringResource(R.string.clip_delete_message)) },
        confirmButton = {
            TextButton(onClick = onConfirm) { Text(stringResource(R.string.delete), color = MaterialTheme.colorScheme.error) }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text(stringResource(R.string.cancel)) } },
    )
}

/** Blocking takes the sender's clips away and stops more: asks first. */
@Composable
fun ConfirmBlockDialog(sender: String, onConfirm: () -> Unit, onDismiss: () -> Unit) {
    AlertDialog(
        onDismissRequest = onDismiss,
        icon = { Icon(painterResource(R.drawable.ic_block), null) },
        title = { Text(stringResource(R.string.clip_block_title, sender)) },
        text = { Text(stringResource(R.string.block_explanation)) },
        confirmButton = {
            TextButton(onClick = onConfirm) { Text(stringResource(R.string.block), color = MaterialTheme.colorScheme.error) }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text(stringResource(R.string.cancel)) } },
    )
}

/**
 * Reporting a clip to Hop's team: what's wrong with it, anything else they
 * should know, and whether to block its sender too.
 */
@Composable
fun ReportSheet(
    clip: Clip,
    sending: Boolean,
    onSend: (reason: ReportReason, note: String, alsoBlock: Boolean) -> Unit,
    onDismiss: () -> Unit,
) {
    val sheet = rememberBottomSheetState(SheetValue.Hidden, enabledValues = setOf(SheetValue.Hidden, SheetValue.Expanded))
    var reason by rememberSaveable { mutableStateOf<ReportReason?>(null) }
    var note by rememberSaveable { mutableStateOf("") }
    var alsoBlock by rememberSaveable { mutableStateOf(false) }
    val sender = clip.contributorName ?: stringResource(R.string.someone)

    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = sheet) {
        Column(
            Modifier.verticalScroll(rememberScrollState()).padding(horizontal = 24.dp).padding(bottom = 24.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Text(stringResource(R.string.report_title), style = MaterialTheme.typography.headlineSmallEmphasized)
            Text(
                stringResource(R.string.report_question),
                style = MaterialTheme.typography.titleSmall,
                color = MaterialTheme.colorScheme.primary,
                modifier = Modifier.padding(top = 8.dp),
            )
            Column(Modifier.selectableGroup()) {
                ReportReason.entries.forEach { option ->
                    Row(
                        Modifier
                            .fillMaxWidth()
                            .selectable(selected = reason == option, role = Role.RadioButton, onClick = { reason = option })
                            .padding(vertical = 10.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(16.dp),
                    ) {
                        RadioButton(selected = reason == option, onClick = null)
                        Text(stringResource(option.label), style = MaterialTheme.typography.bodyLarge)
                    }
                }
            }
            OutlinedTextField(
                value = note,
                onValueChange = { note = it.take(500) },
                label = { Text(stringResource(R.string.report_note)) },
                modifier = Modifier.fillMaxWidth(),
                minLines = 2,
                keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Sentences),
            )
            Text(
                stringResource(R.string.report_footnote),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Row(
                Modifier
                    .fillMaxWidth()
                    .toggleable(value = alsoBlock, role = Role.Switch, onValueChange = { alsoBlock = it })
                    .padding(top = 12.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Column(Modifier.weight(1f)) {
                    Text(stringResource(R.string.clip_block, sender), style = MaterialTheme.typography.bodyLarge)
                    Text(
                        stringResource(R.string.block_explanation),
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                Switch(checked = alsoBlock, onCheckedChange = null, modifier = Modifier.padding(start = 16.dp))
            }
            BigButton(
                text = stringResource(R.string.report_send),
                onClick = { reason?.let { onSend(it, note, alsoBlock) } },
                enabled = reason != null,
                working = sending,
                modifier = Modifier.padding(top = 16.dp),
            )
        }
    }
}
