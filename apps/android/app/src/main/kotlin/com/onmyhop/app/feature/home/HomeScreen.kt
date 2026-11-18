package com.onmyhop.app.feature.home

import androidx.annotation.DrawableRes
import androidx.annotation.StringRes
import androidx.compose.animation.SharedTransitionLayout
import androidx.compose.foundation.layout.Box
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
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.onmyhop.app.feature.event.EventStageScreen
import com.onmyhop.app.feature.event.EventMode
import com.onmyhop.app.core.HopLinks
import com.onmyhop.app.core.HopLink
import androidx.lifecycle.repeatOnLifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.Lifecycle
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
import com.onmyhop.app.feature.account.BlockedSendersScreen
import com.onmyhop.app.feature.account.DeleteAccountScreen
import com.onmyhop.app.feature.account.EditProfileScreen
import com.onmyhop.app.feature.inbox.ClipTransfers
import com.onmyhop.app.feature.inbox.EventScreen
import com.onmyhop.app.feature.inbox.InboxModel
import com.onmyhop.app.feature.inbox.InboxTab
import com.onmyhop.app.feature.inbox.ViewerScreen
import com.onmyhop.app.feature.myhop.MyHopTab
import com.onmyhop.app.feature.myhop.QrScreen
import kotlinx.serialization.Serializable

/** Places in the signed-in app, kept on a back stack that survives process death. */
@Serializable
private data object TabsKey : NavKey

@Serializable
private data object AccountKey : NavKey

@Serializable
private data object BlockedKey : NavKey

@Serializable
private data object QrKey : NavKey

@Serializable
private data object EventStageKey : NavKey

@Serializable
private data object EditProfileKey : NavKey

@Serializable
private data object DeleteAccountKey : NavKey

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
fun HomeScreen(session: Session, transfers: ClipTransfers, eventMode: EventMode, links: HopLinks) {
    val backStack = rememberNavBackStack(TabsKey)
    val state by session.state.collectAsStateWithLifecycle()
    val event by eventMode.state.collectAsStateWithLifecycle()
    // One inbox for the tabs, the events and the viewer, as long as the app is signed in.
    val inbox = viewModel { InboxModel(session) }
    // Again whenever the link moves to another event, and as clips land in Event mode.
    LaunchedEffect(state.me?.activeHopId, event.clips) { inbox.refresh(state.me?.activeHopId) }
    val back: () -> Unit = { backStack.removeLastOrNull() }
    val onStage = backStack.lastOrNull() == EventStageKey

    // Event mode counts while the app is open: often while the QR code is on stage, now and then otherwise.
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    LaunchedEffect(event.run?.hopId, onStage) {
        if (event.run == null) return@LaunchedEffect
        lifecycle.repeatOnLifecycle(Lifecycle.State.STARTED) {
            eventMode.watch(session.api, if (onStage) 4_000 else 15_000)
        }
    }

    // A notification, tile, widget or shortcut asked for a screen. It waits until
    // Event mode has settled, or it could open the pass while an event runs.
    LaunchedEffect(event.hasSettled) {
        if (!event.hasSettled) return@LaunchedEffect
        links.incoming.collect { link ->
            val target = if (eventMode.run != null) EventStageKey else QrKey
            when (link) {
                HopLink.EventStage -> if (eventMode.run != null) backStack.showOnTop(EventStageKey)
                HopLink.QrCode -> backStack.showOnTop(target)
            }
        }
    }

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
                            openQr = { backStack.add(QrKey) },
                            eventMode = eventMode,
                            openStage = { backStack.showOnTop(EventStageKey) },
                        )
                    }
                    entry<EventStageKey> { EventStageScreen(session, eventMode, onMinimize = { backStack.remove(EventStageKey) }) }
                    entry<QrKey> { QrScreen(session, onClose = { backStack.remove(QrKey) }) }
                    entry<AccountKey> {
                        AccountScreen(
                            session = session,
                            inbox = inbox,
                            onBack = { backStack.remove(AccountKey) },
                            openProfile = { backStack.add(EditProfileKey) },
                            openBlocked = { backStack.add(BlockedKey) },
                            openDelete = { backStack.add(DeleteAccountKey) },
                        )
                    }
                    entry<EditProfileKey> {
                        // Without a profile there's nothing to edit; it comes with the session.
                        state.me?.let { EditProfileScreen(it, session, onDone = { backStack.remove(EditProfileKey) }) }
                    }
                    entry<DeleteAccountKey> { DeleteAccountScreen(session, inbox.plan, onBack = { backStack.remove(DeleteAccountKey) }) }
                    entry<BlockedKey> { BlockedSendersScreen(session, onBack = back) }
                    // Screens leave by taking only themselves off the stack, so a
                    // second request to leave can't take the screen below too.
                    entry<EventKey> { key ->
                        EventScreen(
                            hopId = key.hopId,
                            model = inbox,
                            session = session,
                            onBack = { backStack.remove(key) },
                            openClip = { backStack.add(ViewerKey(key.hopId, it)) },
                        )
                    }
                    entry<ViewerKey> { key -> ViewerScreen(key.hopId, key.clipId, inbox, transfers, onBack = { backStack.remove(key) }) }
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
private fun Tabs(
    session: Session,
    inbox: InboxModel,
    openAccount: () -> Unit,
    openEvent: (String) -> Unit,
    openQr: () -> Unit,
    eventMode: EventMode,
    openStage: () -> Unit,
) {
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
            Tab.MyHop -> MyHopTab(session, inbox, accountButton, openQr, eventMode, openStage)
        }
    }
}

/** The athlete's photo, opening their account. */
@Composable
private fun AccountButton(session: Session, onClick: () -> Unit) {
    val state by session.state.collectAsStateWithLifecycle()
    val label = stringResource(R.string.account_title)
    IconButton(onClick = onClick, modifier = Modifier.semantics { contentDescription = label }) {
        // Read out as "Account", not the initial on the avatar.
        Box(Modifier.clearAndSetSemantics {}) { Avatar(state.me, 32.dp) }
    }
}

/** Puts [key] on top of the stack, once: if it's already there, it moves up rather than repeats. */
private fun MutableList<NavKey>.showOnTop(key: NavKey) {
    remove(key)
    add(key)
}
