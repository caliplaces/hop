package com.onmyhop.app.push

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
import com.onmyhop.app.core.HopCard
import com.onmyhop.app.design.Palette
import java.util.concurrent.atomic.AtomicInteger

/** Where pushes show: new clips, and free-plan clips about to leave, each in its own channel. */
interface PushNotifier {
    fun clips(message: PushMessage.Clips)
    fun expiring(message: PushMessage.Expiring)
}

/**
 * Hop's notifications from pushes, in the athlete's colour. New clips are
 * grouped by event; a notice of clips about to leave replaces the one before.
 * On a lock screen that hides what notifications say, only "New clips" shows.
 */
class PushNotifications(private val context: Context) : PushNotifier {
    private val manager = NotificationManagerCompat.from(context)

    /** Each notification of new clips is its own, so several from one event stack up. */
    private val ids = AtomicInteger((System.currentTimeMillis() % 1_000_000_000).toInt())

    init {
        manager.createNotificationChannelsCompat(
            listOf(
                NotificationChannelCompat.Builder(CLIPS, NotificationManagerCompat.IMPORTANCE_DEFAULT)
                    .setName(context.getString(R.string.push_channel_clips))
                    .setDescription(context.getString(R.string.push_channel_clips_description))
                    .build(),
                NotificationChannelCompat.Builder(EXPIRING, NotificationManagerCompat.IMPORTANCE_DEFAULT)
                    .setName(context.getString(R.string.push_channel_expiring))
                    .setDescription(context.getString(R.string.push_channel_expiring_description))
                    .build(),
            ),
        )
    }

    override fun clips(message: PushMessage.Clips) {
        val open = Intent(context, MainActivity::class.java)
            .setAction(MainActivity.ACTION_CLIPS)
            .putExtra(MainActivity.EXTRA_HOP_ID, message.hopId)
            // One intent per event: the extras alone wouldn't tell them apart.
            .setIdentifier("clips:${message.hopId.orEmpty()}")
        val group = "clips:${message.group ?: message.hopId.orEmpty()}"
        val notification = builder(CLIPS, R.drawable.ic_movie, message.title, message.body, open)
            .setCategory(NotificationCompat.CATEGORY_SOCIAL)
            .setGroup(group)
            .setPublicVersion(
                builder(CLIPS, R.drawable.ic_movie, context.getString(R.string.push_clips_public), null, open).build(),
            )
            .build()
        notify(group, ids.incrementAndGet(), notification)
        // The event's notifications together under one heading, which alerts no more than they do.
        val summary = builder(CLIPS, R.drawable.ic_movie, message.title, message.body, open)
            .setGroup(group)
            .setGroupSummary(true)
            .setGroupAlertBehavior(NotificationCompat.GROUP_ALERT_CHILDREN)
            .build()
        notify(group, SUMMARY, summary)
    }

    override fun expiring(message: PushMessage.Expiring) {
        val open = Intent(context, MainActivity::class.java).setAction(MainActivity.ACTION_EXPIRING)
        val notification = builder(EXPIRING, R.drawable.ic_hourglass_bottom, message.title, message.body, open)
            .setCategory(NotificationCompat.CATEGORY_REMINDER)
            .build()
        notify("expiring:${message.tag.orEmpty()}", 0, notification)
    }

    private fun builder(channel: String, icon: Int, title: String, body: String?, open: Intent): NotificationCompat.Builder {
        val color = HopCard.load(context)?.color
        return NotificationCompat.Builder(context, channel)
            .setSmallIcon(icon)
            .setColor(0xFF000000.toInt() or Palette.color(color).hex)
            .setContentTitle(title)
            .apply { if (body != null) setContentText(body).setStyle(NotificationCompat.BigTextStyle().bigText(body)) }
            .setAutoCancel(true)
            .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
            .setContentIntent(
                PendingIntent.getActivity(
                    context,
                    0,
                    open.addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP),
                    PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
                ),
            )
    }

    private fun notify(tag: String, id: Int, notification: android.app.Notification) {
        if (!allowed(context)) return
        try {
            manager.notify(tag, id, notification)
        } catch (_: SecurityException) {
            // Notifications were turned off between the check and now.
        }
    }

    companion object {
        const val CLIPS = "clips"
        const val EXPIRING = "expiring"
        private const val SUMMARY = 0

        /** Whether Hop may show notifications here: allowed, and not turned off in Settings. */
        fun allowed(context: Context): Boolean =
            NotificationManagerCompat.from(context).areNotificationsEnabled() &&
                (
                    Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU ||
                        ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED
                    )
    }
}
