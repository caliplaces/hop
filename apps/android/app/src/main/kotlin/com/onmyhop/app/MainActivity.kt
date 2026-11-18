package com.onmyhop.app

import androidx.core.net.toUri
import android.content.ActivityNotFoundException
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

        setContent { HopApp(container) }
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

    private companion object {
        const val SPLASH_MAX_MS = 1_500L
    }
}
