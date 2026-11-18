package com.onmyhop.app

import androidx.core.net.toUri
import android.content.ActivityNotFoundException
import android.content.Intent
import android.os.Bundle
import android.os.SystemClock
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.browser.auth.AuthTabIntent
import androidx.core.splashscreen.SplashScreen.Companion.installSplashScreen
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.lifecycleScope
import androidx.lifecycle.repeatOnLifecycle
import com.onmyhop.app.auth.Session
import com.onmyhop.app.auth.SignInCallback
import com.onmyhop.app.core.HopLink
import kotlinx.coroutines.launch

class MainActivity : ComponentActivity() {
    private val container by lazy { applicationContext.container }

    /** Caliplaces' sign-in page, in an Auth Tab. Registered up front, as activity results must be. */
    private val authTab = AuthTabIntent.registerActivityResultLauncher(this) { result ->
        when (result.resultCode) {
            AuthTabIntent.RESULT_OK -> result.resultUri?.let { container.signIn.redirected(it) }
            AuthTabIntent.RESULT_VERIFICATION_FAILED, AuthTabIntent.RESULT_VERIFICATION_TIMED_OUT ->
                container.signIn.failed(getString(R.string.sign_in_unverified))
            else -> container.signIn.cancelled()
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        val splash = installSplashScreen()
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()

        // Signed in: Bobble stays up while the profile loads, briefly, so the
        // app opens on the right screen rather than flashing past another.
        val session = container.session
        val started = SystemClock.uptimeMillis()
        if (session.token != null && savedInstanceState == null) {
            splash.setKeepOnScreenCondition {
                session.state.value.let { it.isSignedIn && it.me == null } &&
                    SystemClock.uptimeMillis() - started < SPLASH_MAX_MS
            }
        }

        lifecycleScope.launch {
            repeatOnLifecycle(Lifecycle.State.STARTED) {
                container.signIn.launches.collect(::openSignInPage)
            }
        }

        if (savedInstanceState == null) handle(intent)
        setContent { HopApp(container) }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        handle(intent)
    }

    /** Opens what a notification (or a tile, widget or shortcut) asked for. */
    private fun handle(intent: Intent?) {
        when (intent?.action) {
            ACTION_EVENT_STAGE -> container.links.open(HopLink.EventStage)
            ACTION_QR_CODE -> container.links.open(HopLink.QrCode)
            // Anything can start this activity: only an ID's shape is taken
            // from outside, and only the signed-in athlete's events open.
            ACTION_CLIPS -> container.links.open(HopLink.Clips(intent.getStringExtra(EXTRA_HOP_ID)?.takeIf(HOP_ID::matches)))
            ACTION_EXPIRING -> container.links.open(HopLink.Expiring)
        }
    }

    private fun openSignInPage(started: Session.Started) {
        val intent = AuthTabIntent.Builder().build()
        val url = started.authorizeUrl.toString().toUri()
        try {
            when (val callback = started.callback) {
                is SignInCallback.Scheme -> intent.launch(authTab, url, callback.scheme)
                is SignInCallback.Https -> intent.launch(authTab, url, callback.host, callback.path)
            }
        } catch (_: ActivityNotFoundException) {
            container.signIn.failed(getString(R.string.sign_in_no_browser))
        }
    }

    companion object {
        private const val SPLASH_MAX_MS = 1_500L

        /** Opens Event mode's stage, as its notification does. */
        const val ACTION_EVENT_STAGE = "com.onmyhop.app.action.EVENT_STAGE"

        /** Opens the QR code full screen: Event mode's, if it's running. */
        const val ACTION_QR_CODE = "com.onmyhop.app.action.QR_CODE"

        /** Opens new clips: the event in [EXTRA_HOP_ID], or the inbox. */
        const val ACTION_CLIPS = "com.onmyhop.app.action.CLIPS"

        /** Opens the inbox, which says which free-plan clips are about to leave. */
        const val ACTION_EXPIRING = "com.onmyhop.app.action.EXPIRING"

        const val EXTRA_HOP_ID = "com.onmyhop.app.extra.HOP_ID"
        private val HOP_ID = Regex("[A-Za-z0-9_-]{1,64}")
    }
}
