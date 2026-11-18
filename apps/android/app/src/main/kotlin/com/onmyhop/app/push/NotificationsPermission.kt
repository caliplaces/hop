package com.onmyhop.app.push

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.provider.Settings
import androidx.activity.compose.LocalActivity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.annotation.RequiresApi
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.LocalContext
import androidx.core.content.ContextCompat
import androidx.lifecycle.compose.LifecycleResumeEffect

/** Whether Hop may show notifications here, and a way to ask. */
class NotificationsPermission(val allowed: Boolean, val ask: () -> Unit)

/**
 * Whether notifications are allowed, read again whenever the app comes back
 * (from Settings, say). Newly allowed, this phone registers for them.
 *
 * Asking shows Android's prompt while it still can. Once someone has said
 * no for good, or turned Hop's notifications off in Settings, it opens
 * Hop's notification settings instead.
 */
@Composable
fun rememberNotificationsPermission(push: Push): NotificationsPermission {
    val context = LocalContext.current
    val activity = LocalActivity.current
    var allowed by remember { mutableStateOf(PushNotifications.allowed(context)) }
    fun recheck() {
        val now = PushNotifications.allowed(context)
        if (now && !allowed) push.refresh()
        allowed = now
    }
    LifecycleResumeEffect(Unit) {
        recheck()
        onPauseOrDispose {}
    }
    val prompt = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { recheck() }
    @RequiresApi(Build.VERSION_CODES.TIRAMISU)
    fun canPrompt(): Boolean {
        val permission = Manifest.permission.POST_NOTIFICATIONS
        return ContextCompat.checkSelfPermission(context, permission) != PackageManager.PERMISSION_GRANTED &&
            (!push.hasAsked || activity?.shouldShowRequestPermissionRationale(permission) == true)
    }
    return NotificationsPermission(allowed) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU && canPrompt()) {
            push.markAsked()
            prompt.launch(Manifest.permission.POST_NOTIFICATIONS)
        } else {
            context.startActivity(
                Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, context.packageName),
            )
        }
    }
}
