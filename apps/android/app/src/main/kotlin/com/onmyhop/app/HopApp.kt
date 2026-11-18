package com.onmyhop.app

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.scaleIn
import androidx.compose.animation.togetherWith
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.foundation.layout.fillMaxSize
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.onmyhop.app.design.HopTheme
import com.onmyhop.app.design.Palette
import com.onmyhop.app.feature.claim.ClaimScreen
import com.onmyhop.app.feature.home.HomeScreen
import com.onmyhop.app.feature.profile.ProfileSetupScreen
import com.onmyhop.app.feature.welcome.WelcomeScreen

/** Where the app is, from who is signed in. */
private enum class Stage { Welcome, Claim, Profile, Home }

/**
 * Signed out, the welcome screen; new, claiming a handle and then seeing
 * their profile as others will; otherwise the app. The whole app wears the
 * athlete's colour once they have one.
 */
@Composable
fun HopApp(container: AppContainer) {
    val state by container.session.state.collectAsStateWithLifecycle()
    val me = state.me
    val stage = when {
        !state.isSignedIn -> Stage.Welcome
        me != null && me.handle == null -> Stage.Claim
        me != null && !me.profileReviewed -> Stage.Profile
        else -> Stage.Home
    }

    // The profile, fresh for each session (and each launch).
    LaunchedEffect(state.token) { container.session.refresh() }

    HopTheme(color = me?.paletteColor ?: Palette.brand) {
        val motion = MaterialTheme.motionScheme
        Surface(Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.surface) {
            AnimatedContent(
                targetState = stage,
                transitionSpec = {
                    (fadeIn(motion.defaultEffectsSpec()) + scaleIn(motion.defaultSpatialSpec(), initialScale = 0.96f))
                        .togetherWith(fadeOut(motion.fastEffectsSpec()))
                },
                label = "stage",
            ) { current ->
                when (current) {
                    Stage.Welcome -> WelcomeScreen(container.signIn)
                    Stage.Claim -> me?.let { ClaimScreen(it, container.session) }
                    Stage.Profile -> me?.let { ProfileSetupScreen(it, container.session) }
                    Stage.Home -> HomeScreen(container.session)
                }
            }
        }
    }
}
