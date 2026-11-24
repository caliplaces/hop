package com.onmyhop.app.feature.claim

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.Crossfade
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.ime
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.union
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LoadingIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.LifecycleResumeEffect
import androidx.lifecycle.viewmodel.compose.viewModel
import com.onmyhop.app.R
import com.onmyhop.app.auth.Session
import com.onmyhop.app.core.HopServer
import com.onmyhop.app.core.Me
import com.onmyhop.app.core.spoken
import com.onmyhop.app.design.BigButton
import com.onmyhop.app.design.Bobble
import com.onmyhop.app.design.ColorPicker
import com.onmyhop.app.design.HopTheme
import com.onmyhop.app.design.ReadableWidth
import com.onmyhop.app.feature.account.SignOutMenu

/**
 * Claiming a Hop: the handle everyone uploads to, and the colour Bobble and
 * their page wear. The whole screen wears the colour as it's picked.
 */
@Composable
fun ClaimScreen(me: Me, session: Session) {
    val model = viewModel { ClaimModel(me, session) }
    // Back online after a check that failed: try it again.
    LifecycleResumeEffect(model) {
        model.retry()
        onPauseOrDispose {}
    }
    HopTheme(model.color) {
        Scaffold(
            topBar = {
                TopAppBar(
                    title = {},
                    actions = { SignOutMenu(session) },
                    colors = TopAppBarDefaults.topAppBarColors(containerColor = MaterialTheme.colorScheme.surface),
                )
            },
            bottomBar = {
                Column(
                    Modifier.fillMaxWidth().windowInsetsPadding(WindowInsets.ime.union(WindowInsets.navigationBars)).padding(horizontal = 24.dp, vertical = 16.dp),
                    horizontalAlignment = Alignment.CenterHorizontally,
                ) {
                    val problem = when (val current = model.problem) {
                        ClaimModel.Problem.Offline -> stringResource(R.string.offline)
                        is ClaimModel.Problem.Server -> current.message
                        null -> null
                    }
                    AnimatedVisibility(problem != null) {
                        Text(
                            problem.orEmpty(),
                            color = MaterialTheme.colorScheme.error,
                            style = MaterialTheme.typography.bodyMedium,
                            modifier = Modifier.padding(bottom = 12.dp),
                        )
                    }
                    BigButton(
                        text = stringResource(R.string.claim_button),
                        onClick = model::claim,
                        enabled = model.canClaim || model.isClaiming,
                        working = model.isClaiming,
                        athlete = model.color,
                        modifier = Modifier.widthIn(max = ReadableWidth),
                    )
                }
            },
        ) { padding ->
            Box(Modifier.fillMaxSize().padding(padding), contentAlignment = Alignment.TopCenter) {
                Column(
                    Modifier
                        .widthIn(max = ReadableWidth)
                        .verticalScroll(rememberScrollState())
                        .padding(horizontal = 24.dp),
                    horizontalAlignment = Alignment.CenterHorizontally,
                ) {
                    Crossfade(model.color, label = "bobble") { color ->
                        Bobble(color, Modifier.size(150.dp))
                    }
                    Text(
                        stringResource(R.string.claim_title),
                        style = MaterialTheme.typography.headlineLargeEmphasized,
                        textAlign = TextAlign.Center,
                    )
                    Spacer(Modifier.height(8.dp))
                    Text(
                        stringResource(R.string.claim_message),
                        style = MaterialTheme.typography.bodyLarge,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        textAlign = TextAlign.Center,
                    )
                    Spacer(Modifier.height(24.dp))
                    HandleField(model)
                    Spacer(Modifier.height(32.dp))
                    Text(stringResource(R.string.claim_color_title), style = MaterialTheme.typography.titleMedium)
                    Spacer(Modifier.height(16.dp))
                    ColorPicker(selected = model.color, onSelect = { model.color = it })
                    Spacer(Modifier.height(12.dp))
                    Text(
                        stringResource(R.string.claim_color_message),
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        textAlign = TextAlign.Center,
                    )
                    Spacer(Modifier.height(24.dp))
                }
            }
        }
    }
}

@Composable
private fun HandleField(model: ClaimModel) {
    val status = model.status
    val unavailable = status as? ClaimModel.Status.Unavailable
    OutlinedTextField(
        value = model.input,
        onValueChange = model::type,
        modifier = Modifier.fillMaxWidth(),
        label = { Text(stringResource(R.string.claim_handle_label)) },
        placeholder = { Text(stringResource(R.string.claim_handle_placeholder)) },
        prefix = { Text("${HopServer.baseUrl.spoken}/") },
        singleLine = true,
        isError = unavailable != null,
        keyboardOptions = KeyboardOptions(
            capitalization = KeyboardCapitalization.None,
            autoCorrectEnabled = false,
            keyboardType = KeyboardType.Ascii,
            imeAction = ImeAction.Done,
        ),
        keyboardActions = KeyboardActions(onDone = { if (model.checkFailed) model.retry() else model.claim() }),
        trailingIcon = {
            when (status) {
                ClaimModel.Status.Checking -> LoadingIndicator(Modifier.size(28.dp))
                ClaimModel.Status.Available -> Icon(
                    painterResource(R.drawable.ic_check_circle_filled),
                    contentDescription = null,
                    tint = MaterialTheme.colorScheme.primary,
                )
                is ClaimModel.Status.Unavailable -> if (model.checkFailed) {
                    IconButton(onClick = model::retry) {
                        Icon(painterResource(R.drawable.ic_refresh), stringResource(R.string.try_again))
                    }
                } else {
                    Icon(painterResource(R.drawable.ic_error), contentDescription = null)
                }
                ClaimModel.Status.Idle -> {}
            }
        },
        supportingText = {
            Text(
                when (status) {
                    ClaimModel.Status.Idle -> stringResource(R.string.claim_handle_hint)
                    ClaimModel.Status.Checking -> stringResource(R.string.claim_checking)
                    ClaimModel.Status.Available -> stringResource(R.string.claim_available)
                    is ClaimModel.Status.Unavailable -> stringResource(status.reason.text)
                },
            )
        },
    )
}

private val ClaimModel.Reason.text: Int
    get() = when (this) {
        ClaimModel.Reason.Invalid -> R.string.claim_invalid
        ClaimModel.Reason.Reserved -> R.string.claim_reserved
        ClaimModel.Reason.NotAllowed -> R.string.claim_not_allowed
        ClaimModel.Reason.Taken -> R.string.claim_taken
        ClaimModel.Reason.Offline -> R.string.claim_offline
    }
