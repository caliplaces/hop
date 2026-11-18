package com.onmyhop.app.auth

import android.app.Activity
import android.content.Intent
import android.os.Bundle
import com.onmyhop.app.MainActivity
import com.onmyhop.app.container

/**
 * Receives Caliplaces' redirect in browsers without Auth Tabs, hands it to
 * the sign-in under way, and brings the app back over the browser.
 */
class SignInCallbackActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        intent?.data?.let { container.signIn.redirected(it) }
        startActivity(
            Intent(this, MainActivity::class.java)
                .addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP),
        )
        finish()
    }
}
