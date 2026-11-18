package com.onmyhop.app.feature.account

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LoadingIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.onmyhop.app.R
import com.onmyhop.app.auth.Session
import com.onmyhop.app.core.Me
import com.onmyhop.app.design.ReadableWidth
import com.onmyhop.app.feature.profile.ProfileCard
import com.onmyhop.app.feature.profile.ProfileModel
import kotlinx.coroutines.launch

/** Changing what the athlete's page shows: their name and photo, saved with Save. */
@Composable
fun EditProfileScreen(me: Me, session: Session, onDone: () -> Unit) {
    val model = viewModel { ProfileModel(me, session) }
    val scope = rememberCoroutineScope()
    val focus = LocalFocusManager.current
    val state by session.state.collectAsStateWithLifecycle()
    // The profile can change elsewhere while this is open.
    LaunchedEffect(state.me) { state.me?.let(model::sync) }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(stringResource(R.string.profile_edit_title)) },
                navigationIcon = {
                    IconButton(onClick = onDone) { Icon(painterResource(R.drawable.ic_arrow_back), stringResource(R.string.back)) }
                },
                actions = {
                    if (model.isSaving) {
                        LoadingIndicator(Modifier.padding(end = 16.dp).size(32.dp))
                    } else {
                        TextButton(
                            onClick = {
                                focus.clearFocus()
                                scope.launch { if (model.save()) onDone() }
                            },
                            enabled = model.canSave && model.hasChanges,
                        ) { Text(stringResource(R.string.save)) }
                    }
                },
            )
        },
    ) { padding ->
        Box(Modifier.fillMaxSize().padding(padding).imePadding(), contentAlignment = Alignment.TopCenter) {
            Column(
                Modifier.widthIn(max = ReadableWidth).verticalScroll(rememberScrollState()).padding(24.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                ProfileCard(model)
                AnimatedVisibility(model.problem != null) {
                    Text(
                        model.problem.orEmpty(),
                        color = MaterialTheme.colorScheme.error,
                        style = MaterialTheme.typography.bodyMedium,
                        textAlign = TextAlign.Center,
                        modifier = Modifier.padding(top = 16.dp),
                    )
                }
                Text(
                    stringResource(R.string.profile_footnote),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    textAlign = TextAlign.Center,
                    modifier = Modifier.padding(top = 16.dp),
                )
            }
        }
    }
}
