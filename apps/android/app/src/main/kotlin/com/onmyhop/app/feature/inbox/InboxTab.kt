package com.onmyhop.app.feature.inbox

import android.content.Intent
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
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
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
import androidx.compose.ui.input.nestedscroll.nestedScroll
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.onmyhop.app.R
import com.onmyhop.app.auth.Session
import com.onmyhop.app.core.Hop
import com.onmyhop.app.design.BigButton
import com.onmyhop.app.design.Bobble
import com.onmyhop.app.design.ReadableWidth
import com.onmyhop.app.design.athlete

/** Every event people sent clips to, newest first. */
@Composable
fun InboxTab(session: Session, accountButton: @Composable () -> Unit) {
    val model = viewModel { InboxModel(session) }
    val state by session.state.collectAsStateWithLifecycle()
    val scroll = TopAppBarDefaults.exitUntilCollapsedScrollBehavior()

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
            onRefresh = model::refresh,
            modifier = Modifier.fillMaxSize().padding(padding),
        ) {
            when {
                model.hops.isEmpty() && model.phase == InboxModel.Phase.Loading -> Centered {
                    LoadingIndicator(Modifier.size(64.dp))
                }
                model.hops.isEmpty() && model.phase is InboxModel.Phase.Failed -> Centered {
                    Text(stringResource(R.string.inbox_failed), style = MaterialTheme.typography.titleLarge)
                    Text(
                        (model.phase as InboxModel.Phase.Failed).message ?: stringResource(R.string.offline),
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        textAlign = TextAlign.Center,
                        modifier = Modifier.padding(top = 8.dp, bottom = 16.dp),
                    )
                    OutlinedButton(onClick = model::load) { Text(stringResource(R.string.try_again)) }
                }
                model.phase == InboxModel.Phase.Loaded && model.totalClips == 0 -> EmptyInbox(state.me?.link()?.toString())
                else -> LazyColumn(
                    contentPadding = PaddingValues(start = 16.dp, end = 16.dp, bottom = 24.dp),
                    verticalArrangement = Arrangement.spacedBy(12.dp),
                    modifier = Modifier.fillMaxSize(),
                ) {
                    items(model.hops, key = { it.id }) { hop ->
                        EventCard(hop, isLive = hop.id == state.me?.activeHopId)
                    }
                }
            }
        }
    }
}

/** One event: its name, how much is in it, and whether the link uploads into it now. */
@Composable
private fun EventCard(hop: Hop, isLive: Boolean) {
    val context = LocalContext.current
    Card(
        modifier = Modifier.fillMaxWidth(),
        shape = MaterialTheme.shapes.extraLarge,
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainer),
    ) {
        Column(Modifier.padding(20.dp)) {
            if (isLive || hop.isClosed) {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.padding(bottom = 10.dp)) {
                    if (isLive) Badge(stringResource(R.string.event_your_link), R.drawable.ic_link, live = true)
                    if (hop.isClosed) Badge(stringResource(R.string.event_closed), R.drawable.ic_lock, live = false)
                }
            }
            Text(hop.title, style = MaterialTheme.typography.titleLargeEmphasized)
            Text(
                hop.summary(context),
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

@Composable
private fun Badge(text: String, icon: Int, live: Boolean) {
    val athlete = MaterialTheme.athlete
    Surface(
        shape = MaterialTheme.shapes.extraLarge,
        color = if (live) athlete.color else MaterialTheme.colorScheme.secondaryContainer,
        contentColor = if (live) athlete.onColor else MaterialTheme.colorScheme.onSecondaryContainer,
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
private fun Centered(content: @Composable () -> Unit) {
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
