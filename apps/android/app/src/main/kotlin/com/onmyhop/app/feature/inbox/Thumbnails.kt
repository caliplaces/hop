package com.onmyhop.app.feature.inbox

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.unit.dp
import coil3.compose.AsyncImage
import coil3.request.ImageRequest
import coil3.request.crossfade
import com.onmyhop.app.R
import com.onmyhop.app.core.Clip
import com.onmyhop.app.core.HopServer
import com.onmyhop.app.design.Bobble
import com.onmyhop.app.design.PaletteColor

/**
 * A clip's thumbnail, filling its frame, with a quiet placeholder until it
 * loads or when there isn't one. Thumbnails are private: Coil's client sends
 * the session to the API's host, and the cache is cleared on sign-out.
 */
@Composable
fun ClipThumbnail(clip: Clip, modifier: Modifier = Modifier) {
    val context = LocalContext.current
    Box(modifier.background(MaterialTheme.colorScheme.surfaceContainerHighest), contentAlignment = Alignment.Center) {
        Icon(
            painterResource(if (clip.isVideo) R.drawable.ic_movie else R.drawable.ic_image),
            contentDescription = null,
            tint = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.5f),
        )
        if (clip.hasThumbnail) {
            val request = remember(clip.id) {
                ImageRequest.Builder(context)
                    .data(HopServer.baseUrl.newBuilder().addPathSegments(clip.thumbnailPath).build().toString())
                    .crossfade(true)
                    .build()
            }
            AsyncImage(
                model = request,
                contentDescription = null,
                contentScale = ContentScale.Crop,
                modifier = Modifier.fillMaxSize(),
            )
        }
    }
}

/** Up to three thumbnails tiled as an event's cover, or Bobble when there are none. */
@Composable
fun Mosaic(clips: List<Clip>, color: PaletteColor, modifier: Modifier = Modifier) {
    val gap = 2.dp
    when (clips.size) {
        0 -> Box(
            modifier.fillMaxSize().background(
                Brush.linearGradient(listOf(color.color.copy(alpha = 0.55f), color.color.copy(alpha = 0.15f))),
            ),
            contentAlignment = Alignment.Center,
        ) {
            Bobble(color, Modifier.fillMaxHeight(0.55f).offset(y = (-16).dp))
        }
        1 -> ClipThumbnail(clips[0], modifier.fillMaxSize())
        2 -> Row(modifier.fillMaxSize(), horizontalArrangement = Arrangement.spacedBy(gap)) {
            ClipThumbnail(clips[0], Modifier.weight(1f).fillMaxHeight())
            ClipThumbnail(clips[1], Modifier.weight(1f).fillMaxHeight())
        }
        else -> Row(modifier.fillMaxSize(), horizontalArrangement = Arrangement.spacedBy(gap)) {
            ClipThumbnail(clips[0], Modifier.weight(0.62f).fillMaxHeight())
            Column(Modifier.weight(0.38f).fillMaxHeight(), verticalArrangement = Arrangement.spacedBy(gap)) {
                ClipThumbnail(clips[1], Modifier.weight(1f).fillMaxWidth())
                ClipThumbnail(clips[2], Modifier.weight(1f).fillMaxWidth())
            }
        }
    }
}
