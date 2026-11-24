package com.onmyhop.app.widget

import android.content.Context
import android.content.Intent
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.glance.GlanceId
import androidx.glance.GlanceModifier
import androidx.glance.Image
import androidx.glance.ImageProvider
import androidx.glance.action.clickable
import androidx.glance.appwidget.GlanceAppWidget
import androidx.glance.appwidget.GlanceAppWidgetReceiver
import androidx.glance.appwidget.SizeMode
import androidx.glance.appwidget.action.actionStartActivity
import androidx.glance.appwidget.cornerRadius
import androidx.glance.appwidget.provideContent
import androidx.glance.appwidget.updateAll
import androidx.glance.background
import androidx.glance.layout.Alignment
import androidx.glance.layout.Box
import androidx.glance.layout.Column
import androidx.glance.layout.ContentScale
import androidx.glance.layout.Spacer
import androidx.glance.layout.fillMaxSize
import androidx.glance.layout.fillMaxWidth
import androidx.glance.layout.height
import androidx.glance.layout.padding
import androidx.glance.semantics.contentDescription
import androidx.glance.semantics.semantics
import androidx.glance.text.FontWeight
import androidx.glance.text.Text
import androidx.glance.text.TextAlign
import androidx.glance.text.TextStyle
import androidx.glance.unit.ColorProvider
import com.onmyhop.app.MainActivity
import com.onmyhop.app.R
import com.onmyhop.app.core.HopCard
import com.onmyhop.app.design.Palette
import com.onmyhop.app.design.QrCodes

/**
 * The athlete's QR code on the home screen, in their colour, on white so it
 * always scans. Tapping it opens the code full screen (Event mode's, if it's
 * running). Signed out, it says so instead of showing anyone's code.
 */
class QrWidget : GlanceAppWidget() {
    override val sizeMode = SizeMode.Single

    override suspend fun provideGlance(context: Context, id: GlanceId) {
        val changes = HopCard.changes(context)
        provideContent {
            // Observed while the widget draws: a sign-out or a new handle shows at once.
            val card by changes.collectAsState()
            // The code's modules, drawn once per card rather than on every frame.
            val qr = remember(card?.link) { card?.let { QrCodes.bitmap(it.link, moduleSize = 8, cornerModules = 3f) } }
            Content(context, card, qr)
        }
    }

    @Composable
    private fun Content(context: Context, card: HopCard?, qr: android.graphics.Bitmap?) {
        val color = Palette.color(card?.color)
        val open = actionStartActivity(Intent(context, MainActivity::class.java).setAction(MainActivity.ACTION_QR_CODE))
        Column(
            GlanceModifier
                .fillMaxSize()
                .background(ColorProvider(color.color))
                .cornerRadius(24.dp)
                .padding(12.dp)
                .clickable(open),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            if (card == null || qr == null) {
                Text(
                    context.getString(R.string.widget_signed_out),
                    style = TextStyle(color = ColorProvider(color.onColor), fontSize = 14.sp, textAlign = TextAlign.Center),
                )
                return@Column
            }
            Box(GlanceModifier.defaultWeight().fillMaxWidth(), contentAlignment = Alignment.Center) {
                // Square and centred, white border and rounded corners drawn in,
                // whatever shape the widget is resized to.
                Image(
                    provider = ImageProvider(qr),
                    contentDescription = null,
                    contentScale = ContentScale.Fit,
                    modifier = GlanceModifier
                        .fillMaxSize()
                        .semantics { contentDescription = context.getString(R.string.widget_description, card.link) },
                )
            }
            Spacer(GlanceModifier.height(8.dp))
            Text(
                "@${card.handle}",
                maxLines = 1,
                style = TextStyle(color = ColorProvider(color.onColor), fontSize = 14.sp, fontWeight = FontWeight.Bold),
            )
        }
    }

    companion object {
        /** Redraws every QR widget, as when the card changes. */
        suspend fun refresh(context: Context) {
            QrWidget().updateAll(context)
        }
    }
}

class QrWidgetReceiver : GlanceAppWidgetReceiver() {
    override val glanceAppWidget = QrWidget()
}
