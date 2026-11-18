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
