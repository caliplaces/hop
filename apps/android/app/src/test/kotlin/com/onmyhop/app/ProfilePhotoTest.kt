package com.onmyhop.app

import com.onmyhop.app.feature.profile.ProfilePhoto
import com.onmyhop.app.feature.profile.ProfilePhoto.Square
import org.junit.Assert.assertEquals
import org.junit.Test

class ProfilePhotoTest {
    @Test
    fun cropsTheMiddleWithoutAFace() {
        assertEquals(Square(200, 0, 800), ProfilePhoto.square(1200, 800, face = null))
    }

    @Test
    fun centresOnTheFaceAndStaysInside() {
        assertEquals(Square(0, 0, 800), ProfilePhoto.square(1200, 800, face = 100f to 400f))
        assertEquals(Square(400, 0, 800), ProfilePhoto.square(1200, 800, face = 1150f to 400f))
        assertEquals(Square(0, 100, 800), ProfilePhoto.square(800, 1600, face = 400f to 500f))
    }
}
