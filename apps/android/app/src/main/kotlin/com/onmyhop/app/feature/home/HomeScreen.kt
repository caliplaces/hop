package com.onmyhop.app.feature.home

import androidx.annotation.DrawableRes
import androidx.annotation.StringRes
import androidx.compose.animation.SharedTransitionLayout
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Text
import androidx.compose.material3.adaptive.navigationsuite.NavigationSuiteItem
import androidx.compose.material3.adaptive.navigationsuite.NavigationSuiteScaffold
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.viewmodel.navigation3.rememberViewModelStoreNavEntryDecorator
import androidx.navigation3.runtime.NavKey
import androidx.navigation3.runtime.entryProvider
import androidx.navigation3.runtime.rememberNavBackStack
import androidx.navigation3.runtime.rememberSaveableStateHolderNavEntryDecorator
import androidx.navigation3.ui.NavDisplay
import com.onmyhop.app.R
import com.onmyhop.app.auth.Session
import com.onmyhop.app.design.Avatar
import com.onmyhop.app.design.LocalSharedTransitionScope
import com.onmyhop.app.feature.account.AccountScreen
import com.onmyhop.app.feature.inbox.EventScreen
import com.onmyhop.app.feature.inbox.InboxModel
import com.onmyhop.app.feature.inbox.InboxTab
import com.onmyhop.app.feature.inbox.ViewerScreen
import com.onmyhop.app.feature.myhop.MyHopTab
import kotlinx.serialization.Serializable

/** Places in the signed-in app, kept on a back stack that survives process death. */
@Serializable
private data object TabsKey : NavKey

@Serializable
private data object AccountKey : NavKey

@Serializable
private data class EventKey(val hopId: String) : NavKey

@Serializable
private data class ViewerKey(val hopId: String, val clipId: String) : NavKey

/**
 * The signed-in app: the inbox and the athlete's own link, an event's clips
 * and the viewer above them, and the account. Event cards open into their
 * clips with Material's container transform.
 */
@Composable
fun HomeScreen(session: Session) {
    val backStack = rememberNavBackStack(TabsKey)
    val state by session.state.collectAsStateWithLifecycle()
    // One inbox for the tabs, the events and the viewer, as long as the app is signed in.
    val inbox = viewModel { InboxModel(session) }
    // Again whenever the link moves to another event.
    LaunchedEffect(state.me?.activeHopId) { inbox.refresh(state.me?.activeHopId) }
    val back: () -> Unit = { backStack.removeLastOrNull() }

    SharedTransitionLayout {
        CompositionLocalProvider(LocalSharedTransitionScope provides this) {
            NavDisplay(
                backStack = backStack,
                onBack = back,
                sharedTransitionScope = this,
                entryDecorators = listOf(
                    rememberSaveableStateHolderNavEntryDecorator(),
                    rememberViewModelStoreNavEntryDecorator(),
                ),
                entryProvider = entryProvider {
                    entry<TabsKey> {
                        Tabs(
                            session = session,
                            inbox = inbox,
                            openAccount = { backStack.add(AccountKey) },
                            openEvent = { backStack.add(EventKey(it)) },
                        )
                    }
                    entry<AccountKey> { AccountScreen(session, onBack = back) }
                    entry<EventKey> { key ->
                        EventScreen(
                            hopId = key.hopId,
                            model = inbox,
                            session = session,
                            onBack = back,
                            openClip = { backStack.add(ViewerKey(key.hopId, it)) },
                        )
                    }
                    entry<ViewerKey> { key -> ViewerScreen(key.hopId, key.clipId, inbox, onBack = back) }
                },
            )
        }
    }
}

private enum class Tab(@param:StringRes val label: Int, @param:DrawableRes val icon: Int, @param:DrawableRes val selectedIcon: Int) {
    Inbox(R.string.tab_inbox, R.drawable.ic_inbox, R.drawable.ic_inbox_filled),
    MyHop(R.string.tab_my_hop, R.drawable.ic_qr_code_2, R.drawable.ic_qr_code_2_filled),
}

/** A bottom bar on phones and a rail on bigger screens, as Material's adaptive navigation picks. */
@Composable
private fun Tabs(session: Session, inbox: InboxModel, openAccount: () -> Unit, openEvent: (String) -> Unit) {
    var tab by rememberSaveable { mutableStateOf(Tab.Inbox) }
    val accountButton: @Composable () -> Unit = { AccountButton(session, openAccount) }
    NavigationSuiteScaffold(
        navigationItems = {
            Tab.entries.forEach { item ->
                val selected = tab == item
                NavigationSuiteItem(
                    selected = selected,
                    onClick = { tab = item },
                    icon = { Icon(painterResource(if (selected) item.selectedIcon else item.icon), null) },
                    label = { Text(stringResource(item.label)) },
                )
            }
        },
    ) {
        when (tab) {
            Tab.Inbox -> InboxTab(inbox, session, accountButton, openEvent)
            Tab.MyHop -> MyHopTab(session, accountButton)
        }
    }
}

/** The athlete's photo, opening their account. */
@Composable
private fun AccountButton(session: Session, onClick: () -> Unit) {
    val state by session.state.collectAsStateWithLifecycle()
    val label = stringResource(R.string.account_title)
    IconButton(onClick = onClick, modifier = Modifier.semantics { contentDescription = label }) {
        Avatar(state.me, 32.dp)
    }
}
