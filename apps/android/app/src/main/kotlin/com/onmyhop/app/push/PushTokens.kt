package com.onmyhop.app.push

import android.content.Context
import com.google.android.gms.tasks.Task
import com.google.firebase.FirebaseApp
import com.google.firebase.FirebaseOptions
import com.google.firebase.messaging.FirebaseMessaging
import com.onmyhop.app.BuildConfig
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

/** This install's push token, from Firebase Cloud Messaging. */
interface PushTokens {
    /** The token, asking FCM for one if there isn't one yet. Throws when FCM can't be reached. */
    suspend fun token(): String

    /** Deletes the token: FCM stops taking pushes for it, and the next one asked for is new. */
    suspend fun delete()

    companion object {
        /**
         * Starts Firebase with this build's settings (see build.gradle.kts).
         * Null in builds without them, which have no push notifications.
         */
        fun start(context: Context): PushTokens? {
            val settings = listOf(
                BuildConfig.FIREBASE_APP_ID,
                BuildConfig.FIREBASE_PROJECT_ID,
                BuildConfig.FIREBASE_API_KEY,
                BuildConfig.FIREBASE_SENDER_ID,
            )
            if (settings.any { it.isBlank() }) return null
            if (FirebaseApp.getApps(context).isEmpty()) {
                FirebaseApp.initializeApp(
                    context,
                    FirebaseOptions.Builder()
                        .setApplicationId(BuildConfig.FIREBASE_APP_ID)
                        .setProjectId(BuildConfig.FIREBASE_PROJECT_ID)
                        .setApiKey(BuildConfig.FIREBASE_API_KEY)
                        .setGcmSenderId(BuildConfig.FIREBASE_SENDER_ID)
                        .build(),
                )
            }
            return FirebaseTokens
        }
    }
}

private object FirebaseTokens : PushTokens {
    override suspend fun token(): String = FirebaseMessaging.getInstance().token.await()

    override suspend fun delete() {
        FirebaseMessaging.getInstance().deleteToken().await()
    }
}

private suspend fun <T> Task<T>.await(): T = suspendCancellableCoroutine { continuation ->
    addOnCompleteListener { task ->
        val error = task.exception
        when {
            error != null -> continuation.resumeWithException(error)
            task.isCanceled -> continuation.cancel()
            else -> continuation.resume(task.result)
        }
    }
}
