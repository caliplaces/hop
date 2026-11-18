package com.onmyhop.app

import com.onmyhop.app.feature.inbox.ClipTransfers
import org.junit.Assert.assertEquals
import org.junit.Test

class ClipTransfersTest {
    /** Names come from a stranger's phone: no folders, hidden files or control characters. */
    @Test
    fun fileNamesAreSafe() {
        assertEquals("passwd.mp4", ClipTransfers.safeFileName("../../etc/passwd", "video/mp4"))
        assertEquals("evil.jpg", ClipTransfers.safeFileName("C:\\\\Windows\\\\evil", "image/jpeg"))
        assertEquals("hidden.mov", ClipTransfers.safeFileName(".hidden.mov", "video/quicktime"))
        assertEquals("Hop clip.mp4", ClipTransfers.safeFileName("\u0000\u202e", "video/mp4"))
        assertEquals("abc.mp4", ClipTransfers.safeFileName("a<b>c", "video/mp4"))
    }

    /** The extension matches what the clip is, without doubling one that's already right. */
    @Test
    fun extensionsMatchTheClip() {
        assertEquals("IMG_1.MP4", ClipTransfers.safeFileName("IMG_1.MP4", "video/mp4"))
        assertEquals("round 2.heic", ClipTransfers.safeFileName("round 2", "image/heic"))
        assertEquals("clip.bin", ClipTransfers.safeFileName("clip.bin", "application/octet-stream"))
        assertEquals(104, ClipTransfers.safeFileName("x".repeat(300), "video/mp4").length)
    }
}
