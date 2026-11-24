package com.onmyhop.app

import com.onmyhop.app.core.HopJson
import com.onmyhop.app.core.Me
import com.onmyhop.app.core.spoken
import okhttp3.HttpUrl.Companion.toHttpUrl
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class MeTest {
    private val server = "https://onmyhop.com".toHttpUrl()

    /** Servers from before newer fields leave them out: they get the old behaviour. */
    @Test
    fun decodesOlderServers() {
        val me = HopJson.decodeFromString<Me>("""{"id":"u1","name":null,"email":null,"handle":null,"activeHopId":null,"color":"sky","emailNewClips":true}""")
        assertTrue(me.pushNewClips)
        assertFalse(me.hopPlus)
        assertTrue(me.profileReviewed)
        assertNull(me.avatarUrl)
    }

    @Test
    fun ignoresFieldsItDoesNotKnow() {
        val me = HopJson.decodeFromString<Me>("""{"id":"u1","color":"sky","emailNewClips":false,"somethingNew":1}""")
        assertEquals("u1", me.id)
    }

    /** Photos only ever come from Hop's own site. */
    @Test
    fun photosStayOnHopsSite() {
        fun photo(url: String?) = Me(id = "u", color = "sky", avatarUrl = url).avatar(server)?.toString()
        assertEquals("https://onmyhop.com/api/avatars/a.jpg", photo("/api/avatars/a.jpg"))
        assertNull(photo("//evil.example/a.jpg"))
        assertNull(photo("https://evil.example/a.jpg"))
        assertNull(photo(null))
    }

    @Test
    fun linksToTheirPage() {
        val me = Me(id = "u", color = "sky", handle = "maya")
        assertEquals("onmyhop.com/maya", me.link(server)?.spoken)
        assertEquals("localhost:8787/maya", me.link("http://localhost:8787".toHttpUrl())?.spoken)
        assertNull(Me(id = "u", color = "sky").link(server))
    }

    @Test
    fun initialKeepsWholeCharacters() {
        assertEquals("M", Me(id = "u", color = "sky", name = "maya").initial)
        assertEquals("👩🏽", Me(id = "u", color = "sky", name = "👩🏽 Maya").initial)
        assertEquals("?", Me(id = "u", color = "sky").initial)
        assertEquals("H", Me(id = "u", color = "sky", handle = "hop").initial)
    }
}

class StorageTextTest {
    /** Plans are counted in 1024s, so the free plan reads 15 GB, as on the website and iPhone. */
    @Test
    fun countsLikeThePlans() {
        val gib = 1024L * 1024 * 1024
        assertEquals("15 GB", com.onmyhop.app.core.storageText(15 * gib, java.util.Locale.US))
        assertEquals("200 GB", com.onmyhop.app.core.storageText(200 * gib, java.util.Locale.US))
        assertEquals("1.5 GB", com.onmyhop.app.core.storageText(gib * 3 / 2, java.util.Locale.US))
        assertEquals("0 B", com.onmyhop.app.core.storageText(0, java.util.Locale.US))
        assertEquals("1,5 GB", com.onmyhop.app.core.storageText(gib * 3 / 2, java.util.Locale.GERMANY))
    }
}

class HopCardTest {
    /** The widget and tile show a card only once there's a handle to link to. */
    @Test
    fun cardsNeedAHandle() {
        assertNull(com.onmyhop.app.core.HopCard.from(null))
        assertNull(com.onmyhop.app.core.HopCard.from(Me(id = "u", color = "sky")))
        val card = com.onmyhop.app.core.HopCard.from(Me(id = "u", color = "sky", handle = "maya", name = "Maya"))
        assertEquals("maya", card?.handle)
        assertEquals("sky", card?.color)
        assertTrue(card!!.link.endsWith("/maya"))
    }
}
