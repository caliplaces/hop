package com.onmyhop.app.design

import androidx.core.net.toUri
import android.content.Context
import androidx.browser.customtabs.CustomTabsIntent
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.LoadingIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.graphics.BlendMode
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.CompositingStrategy
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil3.compose.AsyncImage
import com.onmyhop.app.core.Me

/**
 * The screen's main action: a large button, in the athlete's colour when
 * [athlete] is set (as the iPhone app's prominent buttons are), that shows
 * Material's loading indicator while its work runs.
 */
@Composable
fun BigButton(
    text: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    working: Boolean = false,
    athlete: PaletteColor? = null,
) {
    val height = ButtonDefaults.MediumContainerHeight
    val colors = if (athlete != null) {
        ButtonDefaults.buttonColors(containerColor = athlete.color, contentColor = athlete.onColor)
    } else {
        ButtonDefaults.buttonColors()
    }
    Button(
        onClick = { if (!working) onClick() },
        shapes = ButtonDefaults.shapesFor(height),
        modifier = modifier.fillMaxWidth().heightIn(min = height).semantics { if (working) contentDescription = text },
        enabled = enabled,
        colors = colors,
        contentPadding = ButtonDefaults.contentPaddingFor(height),
    ) {
        AnimatedContent(
            targetState = working,
            transitionSpec = { fadeIn() togetherWith fadeOut() },
            label = "working",
        ) { busy ->
            if (busy) {
                LoadingIndicator(
                    modifier = Modifier.size(ButtonDefaults.iconSizeFor(height) * 1.4f),
                    color = athlete?.onColor ?: MaterialTheme.colorScheme.onPrimary,
                )
            } else {
                Text(text, style = ButtonDefaults.textStyleFor(height))
            }
        }
    }
}

/** The athlete's photo, or their initial on their colour when there's none. */
@Composable
fun Avatar(me: Me?, size: Dp, modifier: Modifier = Modifier, photo: Any? = me?.avatar()?.toString()) {
    val color = me?.paletteColor ?: Palette.brand
    Box(
        modifier
            .size(size)
            .clip(CircleShape)
            .background(color.color),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            me?.initial ?: "",
            color = color.onColor,
            fontSize = (size.value * 0.42f).sp,
            fontWeight = FontWeight.SemiBold,
        )
        if (photo != null) {
            AsyncImage(
                model = photo,
                contentDescription = null,
                contentScale = ContentScale.Crop,
                modifier = Modifier.fillMaxSize(),
            )
        }
    }
}

/** Bobble in the athlete's colour, idling. */
@Composable
fun Bobble(color: PaletteColor, modifier: Modifier = Modifier) {
    Image(
        painter = painterResource(color.bobble),
        contentDescription = null,
        modifier = modifier.fadingBottom(),
    )
}

/** Fades the bottom edge out, so Bobble's ground shadow ends softly instead of at the image's edge. */
fun Modifier.fadingBottom(): Modifier = this
    .graphicsLayer { compositingStrategy = CompositingStrategy.Offscreen }
    .drawWithContent {
        drawContent()
        drawRect(
            Brush.verticalGradient(0.78f to Color.Black, 1f to Color.Transparent),
            blendMode = BlendMode.DstIn,
        )
    }

/** Hop's legal pages, on the server this build talks to. */
object HopLegal {
    fun open(context: Context, path: String) {
        val url = com.onmyhop.app.core.HopServer.baseUrl.newBuilder().encodedPath(path).build()
        CustomTabsIntent.Builder().setShowTitle(true).build().launchUrl(context, url.toString().toUri())
    }

    const val PRIVACY = "/privacy"
    const val TERMS = "/terms"
}

/** Fills the width, for content that shouldn't stretch on tablets. */
val ReadableWidth = 560.dp
