package com.onmyhop.app.feature.myhop

import android.app.Activity
import android.view.WindowManager
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.material3.FilledTonalIconButton
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.lerp
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.onmyhop.app.R
import com.onmyhop.app.auth.Session
import com.onmyhop.app.design.Palette
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch

/**
 * The athlete's QR code full screen, bright and awake, for someone to scan:
 * the screen stays on and at full brightness while it shows.
 */
@Composable
fun QrScreen(session: Session, onClose: () -> Unit) {
    val state by session.state.collectAsStateWithLifecycle()
    val me = state.me
    val link = me?.link()
    val color = me?.paletteColor ?: Palette.brand
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val snackbar = remember { SnackbarHostState() }
    val saved = stringResource(R.string.qr_saved)
    val failed = stringResource(R.string.qr_save_failed)

    StageLights()

    Box(
        Modifier
            .fillMaxSize()
            .background(
                Brush.verticalGradient(
                    listOf(lerp(color.color, MaterialTheme.colorScheme.surface, 0.35f), MaterialTheme.colorScheme.surface),
                ),
            )
            .safeDrawingPadding(),
    ) {
        Column(Modifier.fillMaxSize().padding(horizontal = 24.dp), horizontalAlignment = Alignment.CenterHorizontally) {
            Row(Modifier.fillMaxWidth().padding(top = 8.dp)) {
                if (me != null && link != null) {
                    FilledTonalIconButton(onClick = {
                        scope.launch {
                            val message = try {
                                PassImages.saveQrCode(context, me, link)
                                saved
                            } catch (error: CancellationException) {
                                throw error
                            } catch (_: Exception) {
                                failed
                            }
                            snackbar.showSnackbar(message)
                        }
                    }) { Icon(painterResource(R.drawable.ic_download), stringResource(R.string.qr_save)) }
                }
                Spacer(Modifier.weight(1f))
                FilledTonalIconButton(onClick = onClose) {
                    Icon(painterResource(R.drawable.ic_close), stringResource(R.string.close))
                }
            }
            Spacer(Modifier.weight(1f))
            if (me != null && link != null) {
                TurningPass(me, link, stats = null)
                Text(
                    stringResource(R.string.qr_scan),
                    style = MaterialTheme.typography.titleLarge,
                    fontWeight = FontWeight.SemiBold,
                    modifier = Modifier.padding(top = 24.dp),
                )
            }
            Spacer(Modifier.weight(1f))
        }
        SnackbarHost(snackbar, Modifier.align(Alignment.BottomCenter))
    }
}

/** Full brightness and the screen kept on, while this is showing; as it was after. */
@Composable
fun StageLights() {
    val view = LocalView.current
    DisposableEffect(view) {
        val window = (view.context as? Activity)?.window
        val before = window?.attributes?.screenBrightness
        if (window != null) window.attributes = window.attributes.apply { screenBrightness = WindowManager.LayoutParams.BRIGHTNESS_OVERRIDE_FULL }
        view.keepScreenOn = true
        onDispose {
            view.keepScreenOn = false
            if (window != null && before != null) window.attributes = window.attributes.apply { screenBrightness = before }
        }
    }
}
