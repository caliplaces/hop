@file:androidx.annotation.OptIn(markerClass = [androidx.media3.common.util.UnstableApi::class, androidx.media3.common.util.ExperimentalApi::class])

package com.onmyhop.app.feature.inbox

import android.app.Activity
import android.text.format.DateUtils
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.Orientation
import androidx.compose.foundation.gestures.draggable
import androidx.compose.foundation.gestures.rememberDraggableState
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LoadingIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.blur
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import androidx.lifecycle.compose.LifecycleStartEffect
import androidx.media3.common.MediaItem
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.ui.compose.material3.Player as PlayerView
import androidx.media3.ui.compose.material3.PlayerDefaults
import coil3.compose.AsyncImage
import coil3.request.ImageRequest
import com.onmyhop.app.R
import com.onmyhop.app.core.Clip
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.launch

/**
 * An event's clips full screen, one at a time: swipe between them, tap to
 * show or hide the controls, swipe down (or back) to close. Videos loop, and
 * only the clip on screen plays. Links to the bytes last minutes, so each is
 * fetched when its clip comes up, and fetched again if the player gives up
 * on an expired one.
 */
@Composable
fun ViewerScreen(hopId: String, startAt: String, model: InboxModel, onBack: () -> Unit) {
    val clips = model.clips(hopId).items
    if (clips.isEmpty()) {
        LaunchedEffect(Unit) { onBack() }
        return
    }
    val initial = remember { clips.indexOfFirst { it.id == startAt }.coerceAtLeast(0) }
    val pager = rememberPagerState(initialPage = initial) { clips.size }
    val current = clips.getOrNull(pager.settledPage)
    var chrome by rememberSaveable { mutableStateOf(true) }
    val player = rememberLoopingPlayer()

    ImmersiveSystemBars(showBars = chrome)

    // The next page loads before the last clip is reached.
    LaunchedEffect(current?.id) { current?.let { model.loadMoreNear(hopId, it.id) } }

    // Swipe down to close: the clip follows the finger, then lets go.
    val scope = rememberCoroutineScope()
    val drag = remember { Animatable(0f) }
    val closeAt = with(LocalDensity.current) { 140.dp.toPx() }

    Box(
        Modifier
            .fillMaxSize()
            .background(Color.Black)
            .draggable(
                orientation = Orientation.Vertical,
                state = rememberDraggableState { delta -> scope.launch { drag.snapTo((drag.value + delta).coerceAtLeast(0f)) } },
                onDragStopped = {
                    if (drag.value > closeAt) onBack() else scope.launch { drag.animateTo(0f) }
                },
            ),
    ) {
        HorizontalPager(
            state = pager,
            key = { clips[it].id },
            beyondViewportPageCount = 1,
            modifier = Modifier.fillMaxSize().graphicsLayer {
                translationY = drag.value
                val shrink = 1f - (drag.value / (size.height * 2)).coerceIn(0f, 0.15f)
                scaleX = shrink
                scaleY = shrink
            },
        ) { page ->
            val clip = clips[page]
            ClipPage(
                clip = clip,
                isCurrent = page == pager.settledPage,
                player = player,
                showControls = chrome,
                model = model,
                onTap = { chrome = !chrome },
            )
        }

        AnimatedVisibility(chrome && current != null, enter = fadeIn(), exit = fadeOut()) {
            current?.let { TopBar(it, pager.settledPage + 1, clips.size, onBack) }
        }
    }
}

/** Who sent the clip on screen and when, over a fade, with the way back. */
@Composable
private fun TopBar(clip: Clip, position: Int, count: Int, onBack: () -> Unit) {
    Column(
        Modifier
            .fillMaxWidth()
            .background(Brush.verticalGradient(listOf(Color.Black.copy(alpha = 0.6f), Color.Transparent)))
            .statusBarsPadding()
            .padding(bottom = 24.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(horizontal = 4.dp)) {
            IconButton(onClick = onBack) {
                Icon(painterResource(R.drawable.ic_arrow_back), stringResource(R.string.back), tint = Color.White)
            }
            Column(Modifier.weight(1f)) {
                ContributorLabel(clip)
                Text(
                    "${DateUtils.getRelativeTimeSpanString(clip.createdAt)} · $position / $count",
                    style = MaterialTheme.typography.bodySmall,
                    color = Color.White.copy(alpha = 0.75f),
                )
            }
            Spacer(Modifier.width(12.dp))
        }
        clip.note?.takeIf { it.isNotBlank() }?.let { note ->
            Text(
                note,
                style = MaterialTheme.typography.bodyMedium,
                color = Color.White,
                maxLines = 3,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.padding(start = 56.dp, end = 16.dp, top = 4.dp),
            )
        }
    }
}

/** One clip: its thumbnail softly behind, and the video or photo itself on top. */
@Composable
private fun ClipPage(
    clip: Clip,
    isCurrent: Boolean,
    player: ExoPlayer,
    showControls: Boolean,
    model: InboxModel,
    onTap: () -> Unit,
) {
    var link by remember(clip.id) { mutableStateOf<String?>(null) }
    var failed by remember(clip.id) { mutableStateOf(false) }

    // A link for the photo on screen and its neighbours, and for the video on screen.
    LaunchedEffect(clip.id, isCurrent) {
        if (link != null || (clip.isVideo && !isCurrent)) return@LaunchedEffect
        link = runCatching { model.url(clip) }.getOrNull()
        failed = link == null
    }

    Box(
        Modifier
            .fillMaxSize()
            .clickable(interactionSource = remember { MutableInteractionSource() }, indication = null, onClick = onTap),
        contentAlignment = Alignment.Center,
    ) {
        ClipThumbnail(clip, Modifier.fillMaxSize().blur(40.dp).graphicsLayer { alpha = 0.45f })
        when {
            failed -> Text(stringResource(R.string.clip_failed), color = Color.White)
            clip.isVideo && isCurrent && link != null -> VideoPage(clip, link!!, player, showControls, model)
            clip.isVideo -> ClipThumbnail(clip, Modifier.fillMaxSize().graphicsLayer { alpha = 0.9f })
            link != null -> {
                val context = LocalContext.current
                AsyncImage(
                    // Keyed by the clip, not the link, which changes each time it's fetched.
                    model = remember(clip.id, link) {
                        ImageRequest.Builder(context).data(link).memoryCacheKey(clip.id).diskCacheKey(clip.id).build()
                    },
                    contentDescription = null,
                    contentScale = ContentScale.Fit,
                    modifier = Modifier.fillMaxSize(),
                )
            }
            else -> LoadingIndicator(Modifier.size(56.dp), color = Color.White)
        }
    }
}

/** The video on screen, playing in a loop, with Material's player controls while the chrome shows. */
@Composable
private fun VideoPage(clip: Clip, link: String, player: ExoPlayer, showControls: Boolean, model: InboxModel) {
    DisposableEffect(clip.id) {
        player.setMediaItem(MediaItem.fromUri(link))
        player.prepare()
        player.playWhenReady = true
        onDispose { player.stop() }
    }
    // The player gave up, most likely on an expired link: one fresh link, from the same spot.
    LaunchedEffect(clip.id) {
        var retried = false
        player.errors().collect {
            if (retried) return@collect
            retried = true
            val position = player.currentPosition
            val fresh = runCatching { model.url(clip) }.getOrNull() ?: return@collect
            player.setMediaItem(MediaItem.fromUri(fresh), position)
            player.prepare()
        }
    }
    PlayerView(
        player = player,
        modifier = Modifier.fillMaxSize(),
        shutter = { ClipThumbnail(clip, Modifier.fillMaxSize()) },
        showControls = showControls,
        topControls = null,
        bottomControls = { p, visible ->
            PlayerDefaults.BottomControls(p, visible, Modifier.navigationBarsPadding().padding(bottom = 8.dp))
        },
    )
}

/** One player for the whole viewer: it loops, and pauses while the app is in the background. */
@Composable
private fun rememberLoopingPlayer(): ExoPlayer {
    val context = LocalContext.current
    val player = remember {
        ExoPlayer.Builder(context).build().apply { repeatMode = Player.REPEAT_MODE_ONE }
    }
    DisposableEffect(player) { onDispose { player.release() } }
    LifecycleStartEffect(player) {
        onStopOrDispose { player.pause() }
    }
    return player
}

/** The player's errors, as a flow. */
private fun ExoPlayer.errors() = kotlinx.coroutines.flow.callbackFlow {
    val listener = object : Player.Listener {
        override fun onPlayerError(error: PlaybackException) {
            trySend(error)
        }
    }
    addListener(listener)
    awaitClose { removeListener(listener) }
}

/**
 * Light system bar icons on the viewer's black, and the bars themselves
 * tucked away with the chrome (a swipe from the edge brings them back).
 */
@Composable
private fun ImmersiveSystemBars(showBars: Boolean) {
    val view = LocalView.current
    val window = (view.context as? Activity)?.window ?: return
    val controller = remember(window, view) { WindowCompat.getInsetsController(window, view) }
    DisposableEffect(controller) {
        val light = controller.isAppearanceLightStatusBars to controller.isAppearanceLightNavigationBars
        controller.isAppearanceLightStatusBars = false
        controller.isAppearanceLightNavigationBars = false
        controller.systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
        onDispose {
            controller.show(WindowInsetsCompat.Type.systemBars())
            controller.isAppearanceLightStatusBars = light.first
            controller.isAppearanceLightNavigationBars = light.second
        }
    }
    LaunchedEffect(showBars) {
        if (showBars) controller.show(WindowInsetsCompat.Type.systemBars()) else controller.hide(WindowInsetsCompat.Type.systemBars())
    }
}
