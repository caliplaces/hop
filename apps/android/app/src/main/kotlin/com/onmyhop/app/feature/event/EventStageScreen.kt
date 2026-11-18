package com.onmyhop.app.feature.event

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.FilledTonalIconButton
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.draw.scale
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.lerp
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.onmyhop.app.R
import com.onmyhop.app.auth.Session
import com.onmyhop.app.core.spoken
import com.onmyhop.app.design.Palette
import com.onmyhop.app.design.PaletteColor
import com.onmyhop.app.design.QrCode
import com.onmyhop.app.feature.myhop.StageLights
import com.onmyhop.app.feature.myhop.rememberAnimationsOff
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/**
 * Event mode on stage: the QR code big, bright and awake, how long it's been
 * live, and the clips counting up as they land, with a bounce and a buzz.
 */
@Composable
fun EventStageScreen(session: Session, eventMode: EventMode, onMinimize: () -> Unit) {
    val state by eventMode.state.collectAsStateWithLifecycle()
    val me by session.state.collectAsStateWithLifecycle()
    val run = state.run
    val link = me.me?.link()
    if (run == null || link == null) {
        // Ended (here, or the event went away): back to where it was opened from.
        LaunchedEffect(Unit) { onMinimize() }
        return
    }
    val color = me.me?.paletteColor ?: Palette.brand
    val haptics = LocalHapticFeedback.current
    val still by rememberAnimationsOff()
    var confirmingEnd by remember { mutableStateOf(false) }
    /** The arrival shown in the live pill's place, for a few seconds. */
    var shownArrival by remember { mutableStateOf<EventMode.Arrival?>(null) }
    val bounce = remember { Animatable(1f) }

    StageLights()

    LaunchedEffect(state.arrival?.id) {
        val arrival = state.arrival ?: return@LaunchedEffect
        haptics.performHapticFeedback(HapticFeedbackType.Confirm)
        shownArrival = arrival
        if (!still) {
            launch {
                bounce.animateTo(1.06f, tween(140))
                bounce.animateTo(1f, spring(dampingRatio = 0.4f, stiffness = Spring.StiffnessLow))
            }
        }
        delay(4_000)
        if (shownArrival == arrival) shownArrival = null
    }

    Box(
        Modifier
            .fillMaxSize()
            .background(Brush.verticalGradient(listOf(lerp(color.color, Color.Black, 0.1f), lerp(color.color, Color.Black, 0.55f))))
            .safeDrawingPadding(),
    ) {
        Column(Modifier.fillMaxSize().padding(horizontal = 24.dp), horizontalAlignment = Alignment.CenterHorizontally) {
            Row(Modifier.fillMaxWidth().padding(top = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                FilledTonalIconButton(onClick = onMinimize) {
                    Icon(painterResource(R.drawable.ic_keyboard_arrow_down), stringResource(R.string.event_minimize))
                }
                Box(Modifier.weight(1f), contentAlignment = Alignment.Center) {
                    AnimatedContent(shownArrival, transitionSpec = { fadeIn() togetherWith fadeOut() }, label = "pill") { arrival ->
                        if (arrival != null) ArrivalPill(arrival, color) else LivePill(run.startedAt, state.isOffline)
                    }
                }
                TextButton(onClick = { confirmingEnd = true }) {
                    Text(stringResource(R.string.event_end), color = Color.White, fontWeight = FontWeight.SemiBold)
                }
            }
            Spacer(Modifier.weight(1f))
            Text(run.title, color = Color.White, style = MaterialTheme.typography.headlineSmallEmphasized, maxLines = 2, overflow = TextOverflow.Ellipsis, textAlign = TextAlign.Center)
            Text(link.spoken, color = Color.White.copy(alpha = 0.8f), style = MaterialTheme.typography.titleSmall, maxLines = 1)
            QrStage(link.toString(), color, bounce.value, arrival = state.arrival?.id.takeUnless { still }, modifier = Modifier.padding(top = 24.dp))
            Text(
                stringResource(R.string.qr_scan),
                color = Color.White,
                style = MaterialTheme.typography.titleLarge,
                fontWeight = FontWeight.SemiBold,
                modifier = Modifier.padding(top = 20.dp),
            )
            Spacer(Modifier.weight(1f))
            Counter(state.clips, state.latest)
            Spacer(Modifier.size(16.dp))
        }
    }

    if (confirmingEnd) {
        AlertDialog(
            onDismissRequest = { confirmingEnd = false },
            title = { Text(stringResource(R.string.event_end_title)) },
            text = { Text(stringResource(R.string.event_end_message, run.title)) },
            confirmButton = {
                TextButton(onClick = {
                    confirmingEnd = false
                    eventMode.end()
                }) { Text(stringResource(R.string.event_end_confirm), color = MaterialTheme.colorScheme.error) }
            },
            dismissButton = { TextButton(onClick = { confirmingEnd = false }) { Text(stringResource(R.string.cancel)) } },
        )
    }
}

/** The code on white, ringed in the athlete's colour, rippling out each time clips land. */
@Composable
private fun QrStage(link: String, color: PaletteColor, scale: Float, arrival: Long?, modifier: Modifier = Modifier) {
    val ripple = remember { Animatable(1f) }
    LaunchedEffect(arrival) {
        if (arrival == null) return@LaunchedEffect
        ripple.snapTo(0f)
        ripple.animateTo(1f, tween(900))
    }
    val shape = RoundedCornerShape(36.dp)
    Box(
        modifier
            .widthIn(max = 320.dp)
            .scale(scale)
            .drawBehind {
                // A ring that grows and fades from the card's edge.
                val grow = ripple.value
                if (grow < 1f) {
                    drawRoundRect(
                        color = Color.White.copy(alpha = 0.6f * (1f - grow)),
                        topLeft = androidx.compose.ui.geometry.Offset(-24.dp.toPx() * grow, -24.dp.toPx() * grow),
                        size = androidx.compose.ui.geometry.Size(size.width + 48.dp.toPx() * grow, size.height + 48.dp.toPx() * grow),
                        cornerRadius = androidx.compose.ui.geometry.CornerRadius((36.dp + 24.dp * grow).toPx()),
                        style = Stroke(width = 4.dp.toPx()),
                    )
                }
            }
            .shadow(32.dp, shape, ambientColor = color.color, spotColor = color.color),
    ) {
        QrCode(link, description = link, padding = 20.dp, cornerRadius = 36.dp)
    }
}

/** How many clips so far, and who sent the latest, counting up as they land. */
@Composable
private fun Counter(clips: Int, latest: String?) {
    Column(
        horizontalAlignment = Alignment.CenterHorizontally,
        modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite },
    ) {
        AnimatedContent(
            clips,
            transitionSpec = {
                (slideInVertically { it } + fadeIn()) togetherWith (slideOutVertically { -it } + fadeOut())
            },
            label = "count",
        ) { count ->
            Text(count.toString(), color = Color.White, fontSize = 64.sp, fontWeight = FontWeight.Black)
        }
        Text(
            pluralStringResource(R.plurals.event_clips_so_far, clips),
            color = Color.White.copy(alpha = 0.85f),
            style = MaterialTheme.typography.titleMedium,
        )
        Text(
            when {
                clips == 0 -> stringResource(R.string.event_counter_none)
                latest != null -> stringResource(R.string.event_counter_latest, latest)
                else -> stringResource(R.string.event_counter_just_landed)
            },
            color = Color.White.copy(alpha = 0.7f),
            style = MaterialTheme.typography.bodyMedium,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            modifier = Modifier.padding(top = 4.dp),
        )
    }
}

/** LIVE (or OFFLINE) and how long it's been running. */
@Composable
private fun LivePill(startedAt: Long, offline: Boolean) {
    var now by remember { mutableLongStateOf(System.currentTimeMillis()) }
    LaunchedEffect(Unit) {
        while (true) {
            now = System.currentTimeMillis()
            delay(1_000)
        }
    }
    val elapsed = ((now - startedAt) / 1000).coerceAtLeast(0)
    val time = if (elapsed >= 3600) {
        "%d:%02d:%02d".format(elapsed / 3600, elapsed / 60 % 60, elapsed % 60)
    } else {
        "%d:%02d".format(elapsed / 60, elapsed % 60)
    }
    Surface(shape = CircleShape, color = Color.Black.copy(alpha = 0.3f), contentColor = Color.White) {
        Row(
            Modifier.padding(horizontal = 14.dp, vertical = 6.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Box(Modifier.size(8.dp).background(if (offline) Color(0xFFFFB020) else Color(0xFFFF4D4D), CircleShape))
            Text(
                stringResource(if (offline) R.string.event_offline else R.string.event_live),
                style = MaterialTheme.typography.labelLarge,
                fontWeight = FontWeight.Bold,
            )
            Text(time, style = MaterialTheme.typography.labelLarge)
        }
    }
}

/** Who just sent clips, in the live pill's place. */
@Composable
private fun ArrivalPill(arrival: EventMode.Arrival, color: PaletteColor) {
    val someone = stringResource(R.string.someone)
    val sender = arrival.senders.firstOrNull { it != null } ?: someone
    val text = if (arrival.count == 1) {
        stringResource(R.string.event_arrival_one, sender)
    } else {
        pluralStringResource(R.plurals.event_arrival_many, arrival.count, arrival.count)
    }
    Surface(shape = CircleShape, color = color.color, contentColor = color.onColor) {
        Text(text, Modifier.padding(horizontal = 14.dp, vertical = 6.dp), style = MaterialTheme.typography.labelLarge, fontWeight = FontWeight.Bold, maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
}
