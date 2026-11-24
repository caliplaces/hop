package com.onmyhop.app.feature.welcome

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.material3.MaterialShapes
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.toPath
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Matrix
import androidx.compose.ui.graphics.Outline
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.LayoutDirection
import androidx.compose.ui.unit.dp
import androidx.graphics.shapes.Morph
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.onmyhop.app.R
import com.onmyhop.app.auth.SignIn
import com.onmyhop.app.design.BigButton
import com.onmyhop.app.design.ReadableWidth
import com.onmyhop.app.design.fadingBottom
import com.onmyhop.app.design.athlete

/**
 * Signed out: Bobble in a slowly breathing bubble, and one way in, with a
 * Caliplaces account. New athletes claim their link right after. Side by
 * side when the screen is wider than it is tall, as a landscape phone is.
 */
@Composable
fun WelcomeScreen(signIn: SignIn) {
    BoxWithConstraints(Modifier.fillMaxSize().safeDrawingPadding(), contentAlignment = Alignment.Center) {
        if (maxWidth > maxHeight) {
            Row(
                Modifier.fillMaxSize().padding(horizontal = 24.dp, vertical = 16.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Box(Modifier.weight(1f).fillMaxHeight(), contentAlignment = Alignment.Center) {
                    BreathingBubble(Modifier.fillMaxHeight(0.9f))
                }
                Column(
                    Modifier.weight(1f).verticalScroll(rememberScrollState()),
                    horizontalAlignment = Alignment.CenterHorizontally,
                ) {
                    Greeting()
                    Spacer(Modifier.height(24.dp))
                    SignInControls(signIn)
                }
            }
        } else {
            Column(
                Modifier.widthIn(max = ReadableWidth).fillMaxSize().padding(horizontal = 24.dp, vertical = 16.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                // The bubble takes what's left, up to a square, so the button always fits.
                Box(Modifier.weight(1f).fillMaxWidth(), contentAlignment = Alignment.Center) {
                    BreathingBubble(Modifier.fillMaxWidth(0.78f))
                }
                Spacer(Modifier.height(24.dp))
                Greeting()
                Spacer(Modifier.height(32.dp))
                SignInControls(signIn)
            }
        }
    }
}

@Composable
private fun Greeting() {
    Text(
        stringResource(R.string.welcome_title),
        style = MaterialTheme.typography.displaySmallEmphasized,
        textAlign = TextAlign.Center,
    )
    Spacer(Modifier.height(12.dp))
    Text(
        stringResource(R.string.welcome_message),
        style = MaterialTheme.typography.bodyLarge,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        textAlign = TextAlign.Center,
    )
}

@Composable
private fun ColumnScope.SignInControls(signIn: SignIn) {
    val status by signIn.status.collectAsStateWithLifecycle()
    val failure = (status as? SignIn.Status.Failed)?.message
    AnimatedVisibility(failure != null) {
        Text(
            failure.orEmpty(),
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.error,
            textAlign = TextAlign.Center,
            modifier = Modifier.padding(bottom = 12.dp),
        )
    }
    BigButton(
        text = stringResource(R.string.welcome_continue),
        onClick = {
            signIn.dismissError()
            signIn.start()
        },
        working = status == SignIn.Status.Working,
        athlete = MaterialTheme.athlete,
    )
    Text(
        stringResource(R.string.welcome_footnote),
        style = MaterialTheme.typography.bodySmall,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        textAlign = TextAlign.Center,
        modifier = Modifier.padding(top = 12.dp),
    )
}

/**
 * Bobble inside a bubble that slowly turns and breathes between two of
 * Material's expressive shapes, a soft burst and a cookie.
 */
@Composable
private fun BreathingBubble(modifier: Modifier = Modifier) {
    val morph = remember { Morph(MaterialShapes.SoftBurst, MaterialShapes.Cookie9Sided) }
    val transition = rememberInfiniteTransition(label = "bubble")
    val progress by transition.animateFloat(
        initialValue = 0f,
        targetValue = 1f,
        animationSpec = infiniteRepeatable(tween(3_200), RepeatMode.Reverse),
        label = "morph",
    )
    val turn by transition.animateFloat(
        initialValue = 0f,
        targetValue = 360f,
        animationSpec = infiniteRepeatable(tween(40_000, easing = LinearEasing)),
        label = "turn",
    )
    // Square, and as big as the space allows in either direction.
    Box(modifier.aspectRatio(1f, matchHeightConstraintsFirst = true), contentAlignment = Alignment.Center) {
        Box(
            Modifier
                .fillMaxSize()
                .graphicsLayer { rotationZ = turn }
                .clip(MorphShape(morph, progress))
                .background(MaterialTheme.colorScheme.primaryContainer),
        )
        Image(
            painter = painterResource(R.drawable.bobble_idle),
            contentDescription = stringResource(R.string.bobble_description),
            modifier = Modifier.fillMaxSize(0.74f).fadingBottom(),
        )
    }
}

/** A [Morph] between two shapes at [progress], scaled to fill the bounds. */
private class MorphShape(private val morph: Morph, private val progress: Float) : Shape {
    private val path = Path()
    private val matrix = Matrix()

    override fun createOutline(size: Size, layoutDirection: LayoutDirection, density: Density): Outline {
        morph.toPath(progress, path)
        matrix.reset()
        matrix.scale(size.width, size.height)
        path.transform(matrix)
        return Outline.Generic(path)
    }
}
