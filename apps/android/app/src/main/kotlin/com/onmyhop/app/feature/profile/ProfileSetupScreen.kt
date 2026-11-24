package com.onmyhop.app.feature.profile

import androidx.compose.animation.AnimatedVisibility
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
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.onmyhop.app.R
import com.onmyhop.app.auth.Session
import com.onmyhop.app.core.Me
import com.onmyhop.app.design.BigButton
import com.onmyhop.app.design.ReadableWidth
import com.onmyhop.app.feature.account.SignOutMenu
import kotlinx.coroutines.launch

/**
 * "This is you": right after claiming a handle, the athlete sees what their
 * page shows about them, and can change their name and photo before anyone
 * else does.
 */
@Composable
fun ProfileSetupScreen(me: Me, session: Session) {
    val model = viewModel { ProfileModel(me, session) }
    val scope = rememberCoroutineScope()
    val focus = LocalFocusManager.current
    val haptics = LocalHapticFeedback.current
    val state by session.state.collectAsStateWithLifecycle()

    // The profile can change elsewhere while this is open.
    LaunchedEffect(state.me) { state.me?.let(model::sync) }

    Scaffold(
        topBar = { TopAppBar(title = {}, actions = { SignOutMenu(session) }) },
        bottomBar = {
            Column(
                Modifier.fillMaxWidth().windowInsetsPadding(WindowInsets.ime.union(WindowInsets.navigationBars)).padding(horizontal = 24.dp, vertical = 16.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                BigButton(
                    text = stringResource(R.string.profile_looks_good),
                    onClick = {
                        focus.clearFocus()
                        scope.launch {
                            if (model.save(confirming = true)) haptics.performHapticFeedback(HapticFeedbackType.Confirm)
                        }
                    },
                    enabled = model.canSave,
                    working = model.isSaving,
                    athlete = model.me.paletteColor,
                    modifier = Modifier.widthIn(max = ReadableWidth),
                )
            }
        },
    ) { padding ->
        Box(Modifier.fillMaxSize().padding(padding), contentAlignment = Alignment.TopCenter) {
            Column(
                Modifier.widthIn(max = ReadableWidth).verticalScroll(rememberScrollState()).padding(horizontal = 24.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                Text(
                    stringResource(R.string.profile_setup_title),
                    style = MaterialTheme.typography.headlineLargeEmphasized,
                    textAlign = TextAlign.Center,
                )
                Spacer(Modifier.height(8.dp))
                Text(
                    stringResource(R.string.profile_setup_message),
                    style = MaterialTheme.typography.bodyLarge,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    textAlign = TextAlign.Center,
                )
                Spacer(Modifier.height(28.dp))
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
                    modifier = Modifier.padding(vertical = 16.dp),
                )
            }
        }
    }
}
