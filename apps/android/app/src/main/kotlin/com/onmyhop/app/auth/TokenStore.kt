package com.onmyhop.app.auth

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import androidx.core.content.edit
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/** Where the session token is kept between launches. */
interface TokenStore {
    fun read(): String?
    fun write(token: String)
    fun delete()
}

/**
 * Keeps the session token encrypted with an AES key that lives in the
 * Android Keystore and never leaves it. The ciphertext sits in the app's
 * private preferences, one entry per server (see HopServer.storageKey), so a
 * token is never sent to another. Backups are off for the whole app, and the
 * key is bound to this install: a copied file is useless elsewhere.
 */
class KeystoreTokenStore(context: Context, private val account: String) : TokenStore {
    private val preferences = context.getSharedPreferences("hop.session", Context.MODE_PRIVATE)

    override fun read(): String? {
        val stored = preferences.getString(account, null) ?: return null
        return runCatching {
            val bytes = Base64.decode(stored, Base64.NO_WRAP)
            val cipher = Cipher.getInstance(TRANSFORMATION)
            cipher.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, bytes, 0, IV_BYTES))
            cipher.doFinal(bytes, IV_BYTES, bytes.size - IV_BYTES).decodeToString()
        }.getOrElse {
            // The key is gone or the entry is damaged: it can never be read, so it goes.
            delete()
            null
        }
    }

    override fun write(token: String) {
        val cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(Cipher.ENCRYPT_MODE, key())
        val sealed = cipher.iv + cipher.doFinal(token.encodeToByteArray())
        preferences.edit(commit = true) { putString(account, Base64.encodeToString(sealed, Base64.NO_WRAP)) }
    }

    override fun delete() {
        preferences.edit(commit = true) { remove(account) }
    }

    private fun key(): SecretKey {
        val keyStore = KeyStore.getInstance(KEYSTORE).apply { load(null) }
        (keyStore.getKey(ALIAS, null) as? SecretKey)?.let { return it }
        val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, KEYSTORE)
        generator.init(
            KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .build(),
        )
        return generator.generateKey()
    }

    private companion object {
        const val KEYSTORE = "AndroidKeyStore"
        const val ALIAS = "hop.session"
        const val TRANSFORMATION = "AES/GCM/NoPadding"
        const val IV_BYTES = 12
    }
}
