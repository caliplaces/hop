package com.onmyhop.app.feature.myhop

import android.content.ClipData
import android.content.Intent
import androidx.browser.customtabs.CustomTabsIntent
import androidx.compose.animation.AnimatedContent
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.ButtonGroupDefaults
import androidx.compose.material3.ButtonShapes
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.Icon
import androidx.compose.material3.LoadingIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.ToggleButtonShapes
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.compose.ui.graphics.layer.GraphicsLayer
import androidx.compose.ui.graphics.rememberGraphicsLayer
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.ClipEntry
import androidx.compose.ui.platform.LocalClipboard
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.core.net.toUri
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.onmyhop.app.R
import com.onmyhop.app.auth.Session
import com.onmyhop.app.design.ReadableWidth
import com.onmyhop.app.feature.inbox.InboxModel
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import okhttp3.HttpUrl

/**
 * The athlete's link: their Hop pass with the QR code (tap it for the code
 * full screen), and ways to pass the link on, the pass's story image among them.
 */
@Composable
fun MyHopTab(session: Session, inbox: InboxModel, accountButton: @Composable () -> Unit, openQr: () -> Unit) {
    val state by session.state.collectAsStateWithLifecycle()
    val me = state.me
    val link = me?.link()
    // Clips and events, once the inbox has loaded them.
    val stats = if (inbox.phase == InboxModel.Phase.Loaded) PassStats(inbox.hops) else null
    val story = rememberGraphicsLayer()

    Scaffold(
        topBar = {
            TopAppBar(title = { Text(stringResource(R.string.tab_my_hop)) }, actions = { accountButton() })
        },
    ) { padding ->
        Box(Modifier.fillMaxSize().padding(padding), contentAlignment = Alignment.TopCenter) {
            if (me == null || link == null) {
                LoadingIndicator(Modifier.padding(top = 120.dp).size(64.dp))
            } else {
                StoryCapture(me, link, stats, story)
                Column(
                    Modifier
                        .widthIn(max = ReadableWidth)
                        .verticalScroll(rememberScrollState())
                        .padding(horizontal = 20.dp, vertical = 12.dp),
                    horizontalAlignment = Alignment.CenterHorizontally,
                ) {
                    val showLabel = stringResource(R.string.qr_show)
                    TurningPass(me, link, stats, Modifier.clickable(onClickLabel = showLabel, onClick = openQr))
                    Spacer(Modifier.height(20.dp))
                    Text(
                        stringResource(R.string.my_hop_message),
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        textAlign = TextAlign.Center,
                    )
                    Spacer(Modifier.height(24.dp))
                    LinkActions(link, story)
                    Spacer(Modifier.height(12.dp))
                    FilledTonalButton(
                        onClick = openQr,
                        modifier = Modifier.fillMaxWidth().height(ButtonDefaults.MediumContainerHeight),
                    ) { ActionLabel(R.string.qr_show, R.drawable.ic_qr_code_2) }
                }
            }
        }
    }
}

/** Copy, Share (the link, or the pass as a story image) and Open, as one connected button group. */
@Composable
private fun LinkActions(link: HttpUrl, story: GraphicsLayer) {
    val context = LocalContext.current
    val clipboard = LocalClipboard.current
    val haptics = LocalHapticFeedback.current
    val scope = rememberCoroutineScope()
    var copied by remember { mutableStateOf(false) }
    var menu by remember { mutableStateOf(false) }
    LaunchedEffect(copied) {
        if (copied) {
            delay(2_000)
            copied = false
        }
    }
    val shareTitle = stringResource(R.string.share_link)
    val passTitle = stringResource(R.string.share_pass_image)
    val height = ButtonDefaults.MediumContainerHeight

    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(ButtonGroupDefaults.ConnectedSpaceBetween)) {
        FilledTonalButton(
            onClick = {
                scope.launch {
                    clipboard.setClipEntry(ClipEntry(ClipData.newPlainText("Hop link", link.toString())))
                    haptics.performHapticFeedback(HapticFeedbackType.Confirm)
                    copied = true
                }
            },
            shapes = ButtonGroupDefaults.connectedLeadingButtonShapes().asButtonShapes(),
            modifier = Modifier.weight(1f).height(height),
        ) {
            AnimatedContent(copied, label = "copied") { done ->
                ActionLabel(if (done) R.string.copied else R.string.copy, if (done) R.drawable.ic_check else R.drawable.ic_content_copy)
            }
        }
        Box(Modifier.weight(1f)) {
            FilledTonalButton(
                onClick = { menu = true },
                shapes = ButtonGroupDefaults.connectedMiddleButtonShapes().asButtonShapes(),
                modifier = Modifier.fillMaxWidth().height(height),
            ) { ActionLabel(R.string.share, R.drawable.ic_share) }
            DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
                DropdownMenuItem(
                    text = { Text(shareTitle) },
                    leadingIcon = { Icon(painterResource(R.drawable.ic_link), null) },
                    onClick = {
                        menu = false
                        val send = Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, link.toString())
                        context.startActivity(Intent.createChooser(send, shareTitle))
                    },
                )
                DropdownMenuItem(
                    text = { Text(passTitle) },
                    leadingIcon = { Icon(painterResource(R.drawable.ic_image), null) },
                    onClick = {
                        menu = false
                        scope.launch {
                            // The story, as drawn moments ago, at 1080 × 1920.
                            try {
                                PassImages.share(context, story.toImageBitmap().asAndroidBitmap(), passTitle)
                            } catch (error: CancellationException) {
                                throw error
                            } catch (_: Exception) {
                                // Nothing to share if it couldn't be drawn; the link still can be.
                            }
                        }
                    },
                )
            }
        }
        FilledTonalButton(
            onClick = { CustomTabsIntent.Builder().build().launchUrl(context, link.toString().toUri()) },
            shapes = ButtonGroupDefaults.connectedTrailingButtonShapes().asButtonShapes(),
            modifier = Modifier.weight(1f).height(height),
        ) { ActionLabel(R.string.open, R.drawable.ic_open_in_new) }
    }
}

@Composable
internal fun ActionLabel(text: Int, icon: Int) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        Icon(painterResource(icon), null, Modifier.size(ButtonDefaults.IconSize))
        Spacer(Modifier.width(ButtonDefaults.IconSpacing))
        Text(stringResource(text), maxLines = 1)
    }
}

/** A connected group's shapes, for plain (not toggle) buttons. */
private fun ToggleButtonShapes.asButtonShapes() = ButtonShapes(shape = shape, pressedShape = pressedShape)
