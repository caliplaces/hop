package com.onmyhop.app

import androidx.compose.animation.ContentTransform
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.scaleIn
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.repeatOnLifecycle
import androidx.lifecycle.viewmodel.navigation3.rememberViewModelStoreNavEntryDecorator
import androidx.navigation3.runtime.NavEntry
import androidx.navigation3.runtime.rememberSaveableStateHolderNavEntryDecorator
import androidx.navigation3.ui.NavDisplay
import coil3.SingletonImageLoader
import com.onmyhop.app.core.HopCard
import com.onmyhop.app.design.HopTheme
import com.onmyhop.app.design.Palette
import com.onmyhop.app.feature.claim.ClaimScreen
import com.onmyhop.app.feature.home.HomeScreen
import com.onmyhop.app.feature.profile.ProfileSetupScreen
import com.onmyhop.app.feature.welcome.WelcomeScreen
import com.onmyhop.app.widget.QrWidget
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.withContext
import kotlin.time.Duration.Companion.minutes
import kotlin.time.Duration.Companion.seconds

/** Where the app is, from who is signed in. */
private enum class Stage { Welcome, Claim, Profile, Home }

/**
 * Signed out, the welcome screen; new, claiming a handle and then seeing
 * their profile as others will; otherwise the app. The whole app wears the
 * athlete's colour once they have one.
 *
 * The stage is the only entry of a Navigation 3 back stack, so each stage's
 * view models live exactly as long as it does: signing out clears them, and
 * rotating the screen keeps them.
 */
@Composable
fun HopApp(container: AppContainer) {
    val session = container.session
    val state by session.state.collectAsStateWithLifecycle()
    val me = state.me
    val context = LocalContext.current
    val stage = when {
        !state.isSignedIn -> Stage.Welcome
        me != null && me.handle == null -> Stage.Claim
        me != null && !me.profileReviewed -> Stage.Profile
        else -> Stage.Home
    }

    // The profile, fresh each time the app comes to the front. Until it has
    // loaded once (offline at launch, say), it keeps trying, more slowly
    // each time.
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    LaunchedEffect(state.token) {
        if (state.token == null) return@LaunchedEffect
        lifecycle.repeatOnLifecycle(Lifecycle.State.STARTED) {
            var wait = 2.seconds
            while (true) {
                session.refresh()
                if (session.token == null || session.me != null) break
                delay(wait)
                wait = (wait * 2).coerceAtMost(1.minutes)
            }
        }
    }

    // The widget and the tile show this athlete's QR code, and nobody's once they sign out.
    LaunchedEffect(me, state.isSignedIn) {
        val card = if (state.isSignedIn) HopCard.from(me) else null
        // A profile still loading isn't a sign-out: keep the card until it says otherwise.
        if (state.isSignedIn && me == null) return@LaunchedEffect
        if (withContext(Dispatchers.IO) { HopCard.save(context, card) }) QrWidget.refresh(context)
    }

    // Carries on with an event that was running when the app quit, or ends it:
    // it belongs to whoever is signed in, and only to them.
    LaunchedEffect(me?.id) { me?.let(container.eventMode::resume) }

    // Images seen while signed in, such as private thumbnails, are theirs alone.
    LaunchedEffect(state.isSignedIn) {
        if (!state.isSignedIn) {
            // A save or share under way, and Event mode, belonged to whoever was signed in.
            container.transfers.cancel()
            container.eventMode.reset()
            val images = SingletonImageLoader.get(context)
            images.memoryCache?.clear()
            withContext(Dispatchers.IO) { images.diskCache?.clear() }
        }
    }

    HopTheme(color = me?.paletteColor ?: Palette.brand) {
        val motion = MaterialTheme.motionScheme
        val transition: () -> ContentTransform = {
            (fadeIn(motion.defaultEffectsSpec()) + scaleIn(motion.defaultSpatialSpec(), initialScale = 0.96f))
                .togetherWith(fadeOut(motion.fastEffectsSpec()))
        }
        Surface(Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.surface) {
            NavDisplay(
                backStack = listOf(stage),
                entryDecorators = listOf(
                    rememberSaveableStateHolderNavEntryDecorator(),
                    rememberViewModelStoreNavEntryDecorator(),
                ),
                transitionSpec = { transition() },
                popTransitionSpec = { transition() },
                onBack = {},
                entryProvider = { key ->
                    NavEntry(key) {
                        // The latest profile, which every stage but Welcome has.
                        val current = session.state.collectAsStateWithLifecycle().value.me
                        when (key) {
                            Stage.Welcome -> WelcomeScreen(container.signIn)
                            Stage.Claim -> current?.let { ClaimScreen(it, session) }
                            Stage.Profile -> current?.let { ProfileSetupScreen(it, session) }
                            Stage.Home -> HomeScreen(session, container.transfers, container.eventMode, container.links)
                        }
                    }
                },
            )
        }
    }
}
