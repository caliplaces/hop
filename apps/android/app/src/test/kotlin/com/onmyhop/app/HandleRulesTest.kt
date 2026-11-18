package com.onmyhop.app

import com.onmyhop.app.feature.claim.HandleRules
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class HandleRulesTest {
    /** The pattern must be the website's, character for character. */
    @Test
    fun patternMatchesTheWebsites() {
        val source = repositoryFile("packages/shared/src/handles.ts").readText()
        val web = Regex("""HANDLE_PATTERN = /(.+)/;""").find(source)?.groupValues?.get(1)
        assertEquals(web, HandleRules.PATTERN)
    }

    @Test
    fun normalizesLikeTheServer() {
        assertEquals("maya", HandleRules.normalize("  @Maya "))
        assertEquals("maya.k", HandleRules.normalize("Maya.K"))
    }

    @Test
    fun acceptsAndRefuses() {
        assertTrue(HandleRules.isValid("maya"))
        assertTrue(HandleRules.isValid("m_a.y4"))
        assertFalse(HandleRules.isValid("m"))
        assertFalse(HandleRules.isValid("maya."))
        assertFalse(HandleRules.isValid("ma..ya"))
        assertFalse(HandleRules.isValid("maya-k"))
        assertFalse(HandleRules.isValid("a".repeat(31)))
    }

    @Test
    fun suggestsFromTheNameOrEmail() {
        assertEquals("mayakowalski", HandleRules.suggestion("Maya Kowalski", null))
        assertEquals("maya.k", HandleRules.suggestion(null, "maya.k@example.com"))
        assertEquals("", HandleRules.suggestion(null, null))
        assertEquals(30, HandleRules.suggestion("a".repeat(40), null).length)
    }
}
