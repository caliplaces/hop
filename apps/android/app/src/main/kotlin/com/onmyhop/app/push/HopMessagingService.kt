package com.onmyhop.app.push

import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import com.onmyhop.app.container

/** Hands FCM's messages and new tokens to [Push]. */
class HopMessagingService : FirebaseMessagingService() {
    override fun onNewToken(token: String) {
        container.push.tokenChanged()
    }

    override fun onMessageReceived(message: RemoteMessage) {
        container.push.received(message.data)
    }
}
