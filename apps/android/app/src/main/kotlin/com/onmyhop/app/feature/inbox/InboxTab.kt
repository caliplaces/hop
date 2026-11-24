package com.onmyhop.app.feature.inbox

import android.content.Intent
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Icon
import androidx.compose.material3.LargeFlexibleTopAppBar
import androidx.compose.material3.LoadingIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
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
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.onmyhop.app.R
import com.onmyhop.app.push.Push
import com.onmyhop.app.auth.Session
import com.onmyhop.app.core.Clip
import com.onmyhop.app.core.Hop
import com.onmyhop.app.design.BigButton
import com.onmyhop.app.design.Bobble
import com.onmyhop.app.design.PaletteColor
import com.onmyhop.app.design.ReadableWidth
import com.onmyhop.app.design.athlete
import com.onmyhop.app.design.sharedContainer

/** Every event people sent clips to, each a card with its latest clips as the cover. */
@Composable
fun InboxTab(
    model: InboxModel,
    session: Session,
    push: Push,
    accountButton: @Composable () -> Unit,
    openEvent: (String) -> Unit,
) {
    val state by session.state.collectAsStateWithLifecycle()
    val scroll = TopAppBarDefaults.exitUntilCollapsedScrollBehavior()
    val athlete = MaterialTheme.athlete

    Scaffold(
        modifier = Modifier.nestedScroll(scroll.nestedScrollConnection),
        topBar = {
            LargeFlexibleTopAppBar(
                title = { Text(stringResource(R.string.tab_inbox)) },
                actions = { accountButton() },
                scrollBehavior = scroll,
            )
        },
    ) { padding ->
        PullToRefreshBox(
            isRefreshing = model.isRefreshing,
            onRefresh = { model.refresh(state.me?.activeHopId, pulled = true) },
            modifier = Modifier.fillMaxSize().padding(padding),
        ) {
            val phase = model.phase
            when {
                model.hops.isEmpty() && phase == InboxModel.Phase.Loading -> Centered {
                    LoadingIndicator(Modifier.size(64.dp))
                }
                model.hops.isEmpty() && phase is InboxModel.Phase.Failed -> Centered {
                    Text(stringResource(R.string.inbox_failed), style = MaterialTheme.typography.titleLarge)
                    Text(
                        phase.message ?: stringResource(R.string.offline),
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        textAlign = TextAlign.Center,
                        modifier = Modifier.padding(top = 8.dp, bottom = 16.dp),
                    )
                    OutlinedButton(onClick = { model.refresh(state.me?.activeHopId) }) {
                        Text(stringResource(R.string.try_again))
                    }
                }
                phase == InboxModel.Phase.Loaded && model.totalClips == 0 -> EmptyInbox(state.me?.link()?.toString())
                else -> LazyColumn(
                    contentPadding = PaddingValues(start = 16.dp, end = 16.dp, bottom = 24.dp),
                    verticalArrangement = Arrangement.spacedBy(16.dp),
                    modifier = Modifier.fillMaxSize(),
                ) {
                    model.plan?.let { plan ->
                        if (plan.isFree) {
                            plan.expiring?.let { item(key = "expiring") { ExpiryNudge(it) } }
                            if (plan.isNearlyFull) item(key = "storage") { StorageNudge(plan) }
                        }
                        // For whoever wants to hear of new clips, and on the free plan to hear before any leave.
                        if (state.me?.pushNewClips == true || plan.isFree) {
                            item(key = "notifications") { NotificationsNudge(push, plan.isFree) }
                        }
                    }
                    items(model.hops, key = { it.id }) { hop ->
                        EventCard(
                            hop = hop,
                            cover = model.clips(hop.id).items.take(3),
                            isLive = hop.id == state.me?.activeHopId,
                            color = athlete,
                            onOpen = { openEvent(hop.id) },
                            modifier = Modifier.animateItem(),
                        )
                    }
                }
            }
        }
    }
}

/** One event: its latest clips as a cover, its name, and how much is in it. */
@Composable
private fun EventCard(
    hop: Hop,
    cover: List<Clip>,
    isLive: Boolean,
    color: PaletteColor,
    onOpen: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val context = LocalContext.current
    val shape = MaterialTheme.shapes.extraLarge
    val openLabel = stringResource(R.string.event_open)
    Box(
        modifier
            .fillMaxWidth()
            .height(236.dp)
            .sharedContainer("event-${hop.id}", shape)
            .clip(shape)
            .clickable(onClickLabel = openLabel, role = Role.Button, onClick = onOpen),
        contentAlignment = Alignment.BottomStart,
    ) {
        Mosaic(cover, color)
        Box(
            Modifier.fillMaxSize().background(
                Brush.verticalGradient(0.45f to Color.Transparent, 1f to Color.Black.copy(alpha = 0.72f)),
            ),
        )
        Column(Modifier.padding(18.dp)) {
            if (isLive || hop.isClosed) {
                Row(horizontalArrangement = Arrangement.spacedBy(6.dp), modifier = Modifier.padding(bottom = 8.dp)) {
                    if (isLive) Badge(stringResource(R.string.event_your_link), R.drawable.ic_link, color, live = true)
                    if (hop.isClosed) Badge(stringResource(R.string.event_closed), R.drawable.ic_lock, color, live = false)
                }
            }
            Text(
                hop.title,
                style = MaterialTheme.typography.headlineSmallEmphasized,
                color = Color.White,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
            )
            Text(hop.summary(context), style = MaterialTheme.typography.bodyMedium, color = Color.White.copy(alpha = 0.85f))
        }
    }
}

@Composable
private fun Badge(text: String, icon: Int, color: PaletteColor, live: Boolean) {
    Surface(
        shape = MaterialTheme.shapes.extraLarge,
        color = if (live) color.color else Color.Black.copy(alpha = 0.45f),
        contentColor = if (live) color.onColor else Color.White,
    ) {
        Row(
            Modifier.padding(horizontal = 10.dp, vertical = 4.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            Icon(painterResource(icon), null, Modifier.size(14.dp))
            Text(text, style = MaterialTheme.typography.labelMedium)
        }
    }
}

/** Nothing has arrived yet: a nudge to share the link. */
@Composable
private fun EmptyInbox(link: String?) {
    val context = LocalContext.current
    val athlete = MaterialTheme.athlete
    val share = stringResource(R.string.share_link)
    Centered {
        Bobble(athlete, Modifier.size(140.dp))
        Text(stringResource(R.string.inbox_empty_title), style = MaterialTheme.typography.headlineSmallEmphasized)
        Text(
            stringResource(R.string.inbox_empty_message),
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            textAlign = TextAlign.Center,
            modifier = Modifier.padding(top = 8.dp, bottom = 24.dp),
        )
        if (link != null) {
            BigButton(
                text = share,
                athlete = athlete,
                onClick = {
                    val send = Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, link)
                    context.startActivity(Intent.createChooser(send, share))
                },
            )
        }
    }
}

/** Centred in the space left, and scrollable, so pull to refresh still works. */
@Composable
internal fun Centered(content: @Composable () -> Unit) {
    Box(Modifier.fillMaxSize().verticalScroll(rememberScrollState()), contentAlignment = Alignment.Center) {
        Column(
            Modifier.widthIn(max = ReadableWidth).padding(32.dp).padding(top = 48.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            content()
            Spacer(Modifier.height(48.dp))
        }
    }
}
