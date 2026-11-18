package com.onmyhop.app.feature.event

import android.Manifest
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.NotificationChannelCompat
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import com.onmyhop.app.MainActivity
import com.onmyhop.app.R

/**
 * Event mode's ongoing notification: the event, how long it's been live, and
 * the count. On Android 16 it asks to be promoted to a Live Update, with the
 * count in the status bar. Quiet: it updates without a sound or a buzz.
 */
class EventNotification(private val context: Context) : EventNotifier {
    private val manager = NotificationManagerCompat.from(context)

    init {
        manager.createNotificationChannel(
            NotificationChannelCompat.Builder(CHANNEL, NotificationManagerCompat.IMPORTANCE_LOW)
                .setName(context.getString(R.string.event_channel))
                .setDescription(context.getString(R.string.event_channel_description))
                .setShowBadge(false)
                .build(),
        )
    }

    override fun show(run: EventMode.Run, clips: Int, latest: String?) {
        if (!allowed()) return
        // Event mode ends after 12 hours, even with the app closed and not counting.
        val left = run.startedAt + EventMode.MAX_DURATION_MS - System.currentTimeMillis()
        if (left <= 0) {
            clear()
            return
        }
        val open = PendingIntent.getActivity(
            context,
            0,
            Intent(context, MainActivity::class.java)
                .setAction(MainActivity.ACTION_EVENT_STAGE)
                .addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        val resources = context.resources
        val detail = when {
            clips == 0 -> context.getString(R.string.event_counter_none)
            latest != null -> context.getString(R.string.event_counter_latest, latest)
            else -> context.getString(R.string.event_counter_just_landed)
        }
        val notification = NotificationCompat.Builder(context, CHANNEL)
            .setSmallIcon(R.drawable.ic_sensors)
            .setContentTitle(resources.getQuantityString(R.plurals.event_notification_title, clips, clips))
            .setContentText(detail)
            .setSubText(run.title)
            .setWhen(run.startedAt)
            .setShowWhen(true)
            .setUsesChronometer(true)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setSilent(true)
            .setCategory(NotificationCompat.CATEGORY_STATUS)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setContentIntent(open)
            .setTimeoutAfter(left)
            // Android 16: a Live Update, with the count in the status bar.
            .setRequestPromotedOngoing(true)
            .setShortCriticalText(clips.toString())
            .build()
        try {
            manager.notify(ID, notification)
        } catch (_: SecurityException) {
            // Notifications were turned off between the check and now.
        }
    }

    override fun clear() {
        manager.cancel(ID)
    }

    private fun allowed(): Boolean =
        manager.areNotificationsEnabled() &&
            (
                Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU ||
                    ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED
                )

    private companion object {
        const val CHANNEL = "event"
        const val ID = 1
    }
}
