package com.onmyhop.app.feature.profile

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.FilledTonalIconButton
import androidx.compose.material3.Icon
import androidx.compose.material3.LoadingIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.onmyhop.app.R
import com.onmyhop.app.core.spoken
import com.onmyhop.app.design.Avatar

/**
 * What an athlete's page shows about them, editable: their photo (from the
 * system photo picker, which needs no permission) and their name.
 */
@Composable
fun ProfileCard(model: ProfileModel, modifier: Modifier = Modifier) {
    val context = LocalContext.current
    val picker = rememberLauncherForActivityResult(ActivityResultContracts.PickVisualMedia()) { uri ->
        if (uri != null) model.choosePhoto(context.contentResolver, uri)
    }
    var menu by remember { mutableStateOf(false) }
    val pick = { picker.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly)) }

    Card(
        modifier = modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainerLow),
        shape = MaterialTheme.shapes.extraLarge,
    ) {
        Column(
            Modifier.fillMaxWidth().padding(24.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Box {
                Avatar(
                    me = model.me.copy(name = model.normalizedName.ifEmpty { model.me.name }),
                    size = 112.dp,
                    photo = model.shownPhoto,
                )
                if (model.isPreparingPhoto) {
                    LoadingIndicator(Modifier.align(Alignment.Center).size(56.dp))
                }
                Box(Modifier.align(Alignment.BottomEnd).offset(x = 4.dp, y = 4.dp)) {
                    FilledTonalIconButton(
                        onClick = { if (model.hasPhoto) menu = true else pick() },
                    ) {
                        Icon(
                            painterResource(if (model.hasPhoto) R.drawable.ic_edit else R.drawable.ic_add_a_photo),
                            contentDescription = stringResource(
                                if (model.hasPhoto) R.string.profile_change_photo else R.string.profile_add_photo,
                            ),
                        )
                    }
                    DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
                        DropdownMenuItem(
                            text = { Text(stringResource(R.string.profile_choose_photo)) },
                            leadingIcon = { Icon(painterResource(R.drawable.ic_add_a_photo), null) },
                            onClick = {
                                menu = false
                                pick()
                            },
                        )
                        DropdownMenuItem(
                            text = { Text(stringResource(R.string.profile_remove_photo)) },
                            leadingIcon = { Icon(painterResource(R.drawable.ic_delete), null) },
                            onClick = {
                                menu = false
                                model.removePhoto()
                            },
                        )
                    }
                }
            }
            Spacer(Modifier.height(20.dp))
            OutlinedTextField(
                value = model.name,
                onValueChange = { model.name = it },
                modifier = Modifier.fillMaxWidth(),
                label = { Text(stringResource(R.string.profile_name_label)) },
                singleLine = true,
                isError = model.nameChanged && model.nameProblem != null,
                supportingText = model.nameProblem?.takeIf { model.nameChanged }?.let { problem ->
                    { Text(stringResource(problem.text)) }
                },
                keyboardOptions = KeyboardOptions(
                    capitalization = KeyboardCapitalization.Words,
                    imeAction = ImeAction.Done,
                ),
            )
            model.me.link()?.let { link ->
                Text(
                    link.spoken,
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    textAlign = TextAlign.Center,
                    modifier = Modifier.padding(top = 4.dp),
                )
            }
        }
    }
}

private val ProfileModel.NameProblem.text: Int
    get() = when (this) {
        ProfileModel.NameProblem.Empty -> R.string.profile_name_empty
        ProfileModel.NameProblem.TooLong -> R.string.profile_name_too_long
        ProfileModel.NameProblem.StartsWithAt -> R.string.profile_name_at
    }
