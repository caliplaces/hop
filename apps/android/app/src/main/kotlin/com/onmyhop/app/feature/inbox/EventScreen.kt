package com.onmyhop.app.feature.inbox

import android.text.format.DateUtils
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.GridItemSpan
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LoadingIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.MediumFlexibleTopAppBar
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.nestedscroll.nestedScroll
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.onmyhop.app.R
import com.onmyhop.app.auth.Session
import com.onmyhop.app.core.Clip
import com.onmyhop.app.design.sharedContainer

/** One event's clips as a grid of tall tiles, newest first, loading more as they scroll. */
@Composable
fun EventScreen(
    hopId: String,
    model: InboxModel,
    session: Session,
    onBack: () -> Unit,
    openClip: (String) -> Unit,
) {
    val context = LocalContext.current
    val state by session.state.collectAsStateWithLifecycle()
    val hop = model.hop(hopId)
    val list = model.clips(hopId)
    val scroll = TopAppBarDefaults.exitUntilCollapsedScrollBehavior()

    LaunchedEffect(hopId) { if (!list.loadedOnce) model.loadMore(hopId) }

    Scaffold(
        modifier = Modifier
            .sharedContainer("event-$hopId", MaterialTheme.shapes.extraLarge)
            .nestedScroll(scroll.nestedScrollConnection),
        topBar = {
            MediumFlexibleTopAppBar(
                title = { Text(hop?.title.orEmpty(), maxLines = 1, overflow = TextOverflow.Ellipsis) },
                subtitle = hop?.let { { Text(it.summary(context)) } },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(painterResource(R.drawable.ic_arrow_back), stringResource(R.string.back))
                    }
                },
                scrollBehavior = scroll,
            )
        },
    ) { padding ->
        PullToRefreshBox(
            isRefreshing = model.isRefreshing,
            onRefresh = { model.refresh(state.me?.activeHopId, pulled = true) },
            modifier = Modifier.fillMaxSize().padding(padding),
        ) {
            if (list.loadedOnce && list.items.isEmpty()) {
                Centered {
                    Icon(painterResource(R.drawable.ic_movie), null, Modifier.size(48.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
                    Text(
                        stringResource(R.string.event_empty_title),
                        style = MaterialTheme.typography.titleLarge,
                        modifier = Modifier.padding(top = 16.dp),
                    )
                    Text(
                        stringResource(R.string.event_empty_message),
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        textAlign = TextAlign.Center,
                        modifier = Modifier.padding(top = 8.dp),
                    )
                }
                return@PullToRefreshBox
            }
            LazyVerticalGrid(
                columns = GridCells.Adaptive(108.dp),
                contentPadding = PaddingValues(start = 4.dp, end = 4.dp, bottom = 24.dp),
                horizontalArrangement = Arrangement.spacedBy(4.dp),
                verticalArrangement = Arrangement.spacedBy(4.dp),
                modifier = Modifier.fillMaxSize(),
            ) {
                items(list.items, key = { it.id }) { clip ->
                    ClipTile(clip, onClick = { openClip(clip.id) })
                    // Near the end: the next page.
                    if (clip.id == list.items.lastOrNull()?.id) {
                        LaunchedEffect(clip.id) { model.loadMore(hopId) }
                    }
                }
                item(span = { GridItemSpan(maxLineSpan) }, key = "footer") {
                    Box(Modifier.fillMaxWidth().padding(24.dp), contentAlignment = Alignment.Center) {
                        when {
                            list.isLoading || !list.loadedOnce -> LoadingIndicator(Modifier.size(48.dp))
                            list.failed -> Column(horizontalAlignment = Alignment.CenterHorizontally) {
                                Text(
                                    stringResource(R.string.offline),
                                    style = MaterialTheme.typography.bodyMedium,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                )
                                OutlinedButton(onClick = { model.loadMore(hopId) }, Modifier.padding(top = 8.dp)) {
                                    Text(stringResource(R.string.try_again))
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

/** A clip in the grid: its thumbnail, who sent it, and whether it's a video. */
@Composable
private fun ClipTile(clip: Clip, onClick: () -> Unit) {
    val shape = MaterialTheme.shapes.medium
    val sender = clip.contributorName ?: stringResource(R.string.someone)
    val description = stringResource(if (clip.isVideo) R.string.clip_video_from else R.string.clip_photo_from, sender)
    val sent = DateUtils.getRelativeTimeSpanString(clip.createdAt).toString()
    Box(
        Modifier
            .aspectRatio(9f / 16f)
            .clip(shape)
            .clickable(onClick = onClick)
            .clearAndSetSemantics {
                contentDescription = description
                stateDescription = sent
                role = Role.Button
            },
    ) {
        ClipThumbnail(clip, Modifier.fillMaxSize())
        Box(
            Modifier.fillMaxWidth().height(56.dp).align(Alignment.BottomCenter).background(
                Brush.verticalGradient(listOf(Color.Transparent, Color.Black.copy(alpha = 0.55f))),
            ),
        )
        ContributorLabel(
            clip,
            Modifier.align(Alignment.BottomStart).padding(7.dp),
        )
        if (clip.isVideo) {
            Icon(
                painterResource(R.drawable.ic_play_arrow_filled),
                contentDescription = null,
                tint = Color.White,
                modifier = Modifier.align(Alignment.TopEnd).padding(6.dp).size(18.dp),
            )
        }
    }
}

/** Who sent a clip, with a mark when they were signed in. */
@Composable
fun ContributorLabel(clip: Clip, modifier: Modifier = Modifier, color: Color = Color.White) {
    Row(modifier, verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(3.dp)) {
        if (clip.contributorVerified) {
            Icon(
                painterResource(R.drawable.ic_verified_filled),
                contentDescription = stringResource(R.string.clip_signed_in),
                tint = color,
                modifier = Modifier.size(14.dp),
            )
        }
        Text(
            clip.contributorName ?: stringResource(R.string.someone),
            style = MaterialTheme.typography.labelMedium,
            color = color,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
    }
}
