package com.onmyhop.app.feature.myhop

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.VectorConverter
import androidx.compose.animation.core.spring
import androidx.compose.foundation.border
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.lerp
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.onmyhop.app.R
import com.onmyhop.app.core.Hop
import com.onmyhop.app.core.Me
import com.onmyhop.app.core.spoken
import com.onmyhop.app.design.Bobble
import com.onmyhop.app.design.Palette
import com.onmyhop.app.design.QrCode
import kotlinx.coroutines.launch
import okhttp3.HttpUrl
import kotlin.math.max
import kotlin.math.min

/** What the pass shows under the name: clips received and events, across all the athlete's events. */
data class PassStats(val clips: Int, val events: Int) {
    constructor(hops: List<Hop>) : this(clips = hops.sumOf { it.fileCount }, events = hops.size)
}

/**
 * The athlete's Hop pass: their colour with a holographic foil that shifts as
 * it turns, Bobble peeking over the top, the QR code on white so it always
 * scans, and their clips and events.
 */
@Composable
fun HopPass(me: Me, link: HttpUrl, stats: PassStats?, modifier: Modifier = Modifier, tilt: () -> Offset = { Offset.Zero }) {
    val color = me.paletteColor
    val shape = RoundedCornerShape(34.dp)
    val density = LocalDensity.current
    val clips = stats?.let { pluralStringResource(R.plurals.clip_count, it.clips, it.clips) }
    val events = stats?.let { pluralStringResource(R.plurals.event_count, it.events, it.events) }
    val description = listOfNotNull(me.name, link.spoken, clips, events).joinToString(", ")
    val passLabel = stringResource(R.string.pass_description)

    Box(modifier.clearAndSetSemantics { contentDescription = "$passLabel: $description" }, contentAlignment = Alignment.TopCenter) {
        Bobble(
            color,
            Modifier.size(104.dp).graphicsLayer {
                translationX = tilt().x * -6 * density.density
                translationY = tilt().y * -4 * density.density
            },
        )
        Column(
            Modifier
                .padding(top = 78.dp)
                .shadow(28.dp, shape, ambientColor = color.color, spotColor = color.color)
                .clip(shape)
                .holoFoil(color.color, tilt)
                // A bright edge, like the rim of a laminated card.
                .border(
                    1.2.dp,
                    Brush.linearGradient(listOf(Color.White.copy(alpha = 0.55f), Color.White.copy(alpha = 0.08f), Color.White.copy(alpha = 0.3f))),
                    shape,
                )
                .padding(22.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            val ink = color.onColor
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.Bottom) {
                Text("hop", color = ink, fontSize = 24.sp, fontWeight = FontWeight.Black)
                Spacer(Modifier.weight(1f))
                Text(
                    stringResource(R.string.pass_athlete),
                    color = ink.copy(alpha = 0.8f),
                    style = MaterialTheme.typography.labelSmall,
                    fontWeight = FontWeight.ExtraBold,
                    letterSpacing = 1.8.sp,
                )
            }
            QrCode(
                link.toString(),
                description = link.spoken,
                modifier = Modifier
                    .padding(top = 20.dp)
                    .widthIn(max = 190.dp)
                    .shadow(12.dp, RoundedCornerShape(22.dp), ambientColor = Color.Black.copy(alpha = 0.15f)),
            )
            Text(
                me.name ?: "@${me.handle}",
                color = ink,
                style = MaterialTheme.typography.titleLarge,
                fontWeight = FontWeight.Bold,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.padding(top = 16.dp),
            )
            Text(
                link.spoken,
                color = ink.copy(alpha = 0.78f),
                style = MaterialTheme.typography.titleSmall,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            HorizontalDivider(Modifier.padding(top = 16.dp), color = ink.copy(alpha = 0.22f))
            Row(Modifier.fillMaxWidth().padding(top = 12.dp), horizontalArrangement = Arrangement.SpaceBetween) {
                val style = MaterialTheme.typography.labelLarge
                if (clips != null && events != null) {
                    Text(clips, color = ink.copy(alpha = 0.85f), style = style)
                    Text(events, color = ink.copy(alpha = 0.85f), style = style)
                } else {
                    Text(stringResource(R.string.pass_tagline), color = ink.copy(alpha = 0.85f), style = style)
                }
            }
        }
    }
}

/**
 * The Hop pass, turning with the phone and under a finger, and settling back
 * with a spring. Still when the system's animations are off.
 */
@Composable
fun TurningPass(me: Me, link: HttpUrl, stats: PassStats?, modifier: Modifier = Modifier) {
    val context = LocalContext.current
    val still = remember { animationsOff(context) }
    val tilt by rememberTilt()
    val drag = remember { Animatable(Offset.Zero, Offset.VectorConverter) }
    val scope = rememberCoroutineScope()
    val reach = with(LocalDensity.current) { 140.dp.toPx() }
    val turn = {
        if (still) {
            Offset.Zero
        } else {
            Offset(
                max(-1f, min(1f, tilt.x + drag.value.x / reach)),
                max(-1f, min(1f, tilt.y + drag.value.y / reach)),
            )
        }
    }
    HopPass(
        me = me,
        link = link,
        stats = stats,
        tilt = turn,
        modifier = modifier
            .widthIn(max = 340.dp)
            .graphicsLayer {
                val now = turn()
                rotationY = now.x * 14f
                rotationX = now.y * 12f
                cameraDistance = 12f * density
            }
            .then(
                if (still) {
                    Modifier
                } else {
                    Modifier.pointerInput(Unit) {
                        detectDragGestures(
                            onDragEnd = {
                                scope.launch { drag.animateTo(Offset.Zero, spring(dampingRatio = 0.5f, stiffness = Spring.StiffnessLow)) }
                            },
                            onDragCancel = { scope.launch { drag.animateTo(Offset.Zero) } },
                        ) { change, amount ->
                            change.consume()
                            scope.launch { drag.snapTo(drag.value + amount) }
                        }
                    }
                },
            ),
    )
}

/**
 * The pass on a story-sized backdrop (9:16), for sharing to Instagram stories
 * and the like: the pass turned a little, the link, and an invitation.
 */
@Composable
fun PassStory(me: Me, link: HttpUrl, stats: PassStats?, modifier: Modifier = Modifier) {
    val color = me.paletteColor.color
    val brand = Palette.brand.color
    Box(
        modifier.drawBehind {
            // Black, lit from the middle in the athlete's colour, with a touch of Hop's own.
            drawRect(Color.Black)
            drawRect(
                Brush.radialGradient(
                    listOf(lerp(color, Color.Black, 0.15f), lerp(color, Color.Black, 0.55f), Color.Transparent),
                    center = Offset(size.width * 0.55f, size.height * 0.45f),
                    radius = size.height * 0.62f,
                ),
            )
            drawRect(
                Brush.radialGradient(
                    listOf(lerp(brand, Color.Black, 0.5f).copy(alpha = 0.7f), Color.Transparent),
                    center = Offset(size.width, size.height * 0.5f),
                    radius = size.width * 0.9f,
                ),
            )
        },
        contentAlignment = Alignment.Center,
    ) {
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            HopPass(
                me = me,
                link = link,
                stats = stats,
                tilt = { Offset(0.45f, -0.3f) },
                modifier = Modifier.widthIn(max = 300.dp).graphicsLayer {
                    rotationY = -7f
                    rotationX = 3f
                    cameraDistance = 14f * density
                },
            )
            Text(
                stringResource(R.string.pass_story_invitation),
                color = Color.White,
                fontSize = 22.sp,
                fontWeight = FontWeight.Bold,
                modifier = Modifier.padding(top = 36.dp),
            )
            Text(
                link.spoken,
                color = Color.White.copy(alpha = 0.7f),
                fontSize = 17.sp,
                fontWeight = FontWeight.SemiBold,
                modifier = Modifier.padding(top = 6.dp),
            )
            Spacer(Modifier.height(24.dp))
        }
    }
}
