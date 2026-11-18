package com.onmyhop.app

import android.app.Application
import android.content.Context
import coil3.ImageLoader
import coil3.PlatformContext
import coil3.SingletonImageLoader
import coil3.network.okhttp.OkHttpNetworkFetcherFactory
import coil3.request.crossfade
import com.onmyhop.app.auth.KeystoreTokenStore
import com.onmyhop.app.auth.Session
import com.onmyhop.app.auth.SignIn
import com.onmyhop.app.core.HopLinks
import com.onmyhop.app.core.HopServer
import com.onmyhop.app.feature.event.EventMode
import com.onmyhop.app.feature.event.EventNotification
import com.onmyhop.app.feature.inbox.ClipTransfers
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.MainScope
import okhttp3.OkHttpClient
import java.util.concurrent.TimeUnit

/** What the whole app shares: one HTTP client, the session, and signing in. */
class AppContainer(context: Context) {
    /** Lives as long as the app, for work no screen owns, such as finishing a sign-in. */
    val scope: CoroutineScope = MainScope()

    val http: OkHttpClient = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(30, TimeUnit.SECONDS)
        .build()

    val session = Session(
        store = KeystoreTokenStore(context, account = HopServer.storageKey(HopServer.baseUrl)),
        baseUrl = HopServer.baseUrl,
        http = http,
        scope = scope,
    )

    val signIn = SignIn(session, scope)

    /** Saving clips to the gallery and downloading them to share, outliving any one screen. */
    val transfers = ClipTransfers(context, http, scope)

    /** Places outside the app ask to open: a notification, a tile, a widget, a shortcut. */
    val links = HopLinks()

    /** Event mode, which outlives any one screen. */
    val eventMode = EventMode(context.getSharedPreferences("hop.event", Context.MODE_PRIVATE), EventNotification(context))

    /**
     * Images from Hop's API. Requests to the API's own host carry the
     * session, which private images such as thumbnails need; nothing else
     * ever sees the token.
     */
    val images: OkHttpClient = http.newBuilder()
        .addInterceptor { chain ->
            val request = chain.request()
            val token = session.token
            val api = session.baseUrl
            if (token != null && request.url.scheme == api.scheme && request.url.host == api.host && request.url.port == api.port) {
                chain.proceed(request.newBuilder().header("Authorization", "Bearer $token").build())
            } else {
                chain.proceed(request)
            }
        }
        .build()
}

class HopApplication : Application(), SingletonImageLoader.Factory {
    lateinit var container: AppContainer
        private set

    override fun onCreate() {
        super.onCreate()
        container = AppContainer(this)
        // Saves cut short and files shared last time, from before the app was closed.
        container.transfers.removeLeftovers()
    }

    override fun newImageLoader(context: PlatformContext): ImageLoader =
        ImageLoader.Builder(context)
            .components { add(OkHttpNetworkFetcherFactory(callFactory = { container.images })) }
            .crossfade(true)
            .build()
}

val Context.container: AppContainer get() = (applicationContext as HopApplication).container
