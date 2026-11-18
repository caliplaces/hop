package com.onmyhop.app.feature.myhop

import androidx.core.net.toUri
import android.content.ClipData
import android.content.Intent
import androidx.browser.customtabs.CustomTabsIntent
import androidx.compose.animation.AnimatedContent
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
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
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
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.ClipEntry
import androidx.compose.ui.platform.LocalClipboard
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.onmyhop.app.R
import com.onmyhop.app.auth.Session
import com.onmyhop.app.core.Me
import com.onmyhop.app.core.spoken
import com.onmyhop.app.design.Avatar
import com.onmyhop.app.design.ReadableWidth
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import okhttp3.HttpUrl

/** The athlete's link: their card, and ways to pass it on. */
@Composable
fun MyHopTab(session: Session, accountButton: @Composable () -> Unit) {
    val state by session.state.collectAsStateWithLifecycle()
    val me = state.me
    val link = me?.link()

    Scaffold(
        topBar = {
            TopAppBar(title = { Text(stringResource(R.string.tab_my_hop)) }, actions = { accountButton() })
        },
    ) { padding ->
        Box(Modifier.fillMaxSize().padding(padding), contentAlignment = Alignment.TopCenter) {
            if (me == null || link == null) {
                LoadingIndicator(Modifier.padding(top = 120.dp).size(64.dp))
            } else {
                Column(
                    Modifier
                        .widthIn(max = ReadableWidth)
                        .verticalScroll(rememberScrollState())
                        .padding(horizontal = 20.dp, vertical = 12.dp),
                    horizontalAlignment = Alignment.CenterHorizontally,
                ) {
                    PassCard(me, link)
                    Spacer(Modifier.height(16.dp))
                    Text(
                        stringResource(R.string.my_hop_message),
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        textAlign = TextAlign.Center,
                    )
                    Spacer(Modifier.height(24.dp))
                    LinkActions(link)
                }
            }
        }
    }
}

/** The athlete's card, in their colour: who they are and where to send clips. */
@Composable
private fun PassCard(me: Me, link: HttpUrl) {
    val color = me.paletteColor
    Card(
        modifier = Modifier.fillMaxWidth(),
        shape = MaterialTheme.shapes.extraLarge,
        colors = CardDefaults.cardColors(containerColor = color.color, contentColor = color.onColor),
    ) {
        Column(Modifier.fillMaxWidth().padding(28.dp), horizontalAlignment = Alignment.CenterHorizontally) {
            Avatar(me, 88.dp)
            Spacer(Modifier.height(16.dp))
            Text(
                me.name ?: "@${me.handle}",
                style = MaterialTheme.typography.headlineSmallEmphasized,
                textAlign = TextAlign.Center,
            )
            Text(
                link.spoken,
                style = MaterialTheme.typography.titleMedium,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.padding(top = 4.dp),
            )
        }
    }
}

/** Copy, Share and Open, as one connected button group. */
@Composable
private fun LinkActions(link: HttpUrl) {
    val context = LocalContext.current
    val clipboard = LocalClipboard.current
    val haptics = LocalHapticFeedback.current
    val scope = rememberCoroutineScope()
    var copied by remember { mutableStateOf(false) }
    LaunchedEffect(copied) {
        if (copied) {
            delay(2_000)
            copied = false
        }
    }
    val shareTitle = stringResource(R.string.share_link)
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
                ActionLabel(
                    if (done) R.string.copied else R.string.copy,
                    if (done) R.drawable.ic_check else R.drawable.ic_content_copy,
                )
            }
        }
        FilledTonalButton(
            onClick = {
                val send = Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, link.toString())
                context.startActivity(Intent.createChooser(send, shareTitle))
            },
            shapes = ButtonGroupDefaults.connectedMiddleButtonShapes().asButtonShapes(),
            modifier = Modifier.weight(1f).height(height),
        ) { ActionLabel(R.string.share, R.drawable.ic_share) }
        FilledTonalButton(
            onClick = { CustomTabsIntent.Builder().build().launchUrl(context, link.toString().toUri()) },
            shapes = ButtonGroupDefaults.connectedTrailingButtonShapes().asButtonShapes(),
            modifier = Modifier.weight(1f).height(height),
        ) { ActionLabel(R.string.open, R.drawable.ic_open_in_new) }
    }
}

@Composable
private fun ActionLabel(text: Int, icon: Int) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        Icon(painterResource(icon), null, Modifier.size(ButtonDefaults.IconSize))
        Spacer(Modifier.width(ButtonDefaults.IconSpacing))
        Text(stringResource(text), maxLines = 1)
    }
}

/** A connected group's shapes, for plain (not toggle) buttons. */
private fun ToggleButtonShapes.asButtonShapes() = ButtonShapes(shape = shape, pressedShape = pressedShape)
