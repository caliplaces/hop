package com.onmyhop.app

import com.onmyhop.app.design.Palette
import com.onmyhop.app.design.hopColorScheme
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

class PaletteTest {
    /** The app's palette must match the website's, colour for colour. */
    @Test
    fun matchesTheSharedPalette() {
        val source = repositoryFile("packages/shared/src/colors.ts").readText()
        val entry = Regex("""\{ id: "(\w+)", name: "([^"]+)", hex: "#([0-9A-Fa-f]{6})" \}""")
        val shared = entry.findAll(source).map { Triple(it.groupValues[1], it.groupValues[2], it.groupValues[3].toInt(16)) }.toList()

        assertEquals(shared.size, Palette.all.size)
        Palette.all.zip(shared).forEach { (app, web) ->
            assertEquals(web.first, app.id)
            assertEquals(web.second, app.name)
            assertEquals(app.id, web.third, app.hex)
        }
    }

    /** As on the web: every colour gets ink or white text that passes WCAG AA. */
    @Test
    fun textOnEveryColourIsReadable() {
        Palette.all.forEach { color ->
            assertTrue(color.id, Palette.contrast(color.hex, color.onColorHex) >= 4.5)
        }
    }

    @Test
    fun unknownColoursFallBackToTheBrand() {
        assertEquals(Palette.brand, Palette.color("lime"))
        assertEquals(Palette.brand, Palette.color(null))
        assertEquals(Palette.sky, Palette.color("sky"))
        assertEquals("grape", Palette.brand.id)
    }

    /** Every colour grows a full scheme, different in light and dark, with readable text on its primary. */
    @Test
    fun everyColourGrowsAReadableScheme() {
        Palette.all.forEach { color ->
            val light = hopColorScheme(color.hex, dark = false)
            val dark = hopColorScheme(color.hex, dark = true)
            assertNotEquals(color.id, light.surface, dark.surface)
            for (scheme in listOf(light, dark)) {
                val ratio = Palette.contrast(scheme.primary.rgb(), scheme.onPrimary.rgb())
                assertTrue("${color.id}: $ratio", ratio >= 4.5)
            }
        }
    }

    private fun androidx.compose.ui.graphics.Color.rgb(): Int =
        ((red * 255).toInt() shl 16) or ((green * 255).toInt() shl 8) or (blue * 255).toInt()
}

/** A file in the repository, found from the app module (where Gradle runs unit tests). */
fun repositoryFile(path: String): File {
    var dir: File? = File("").absoluteFile
    while (dir != null) {
        val candidate = File(dir, path)
        if (candidate.exists()) return candidate
        dir = dir.parentFile
    }
    error("$path not found above ${File("").absolutePath}")
}
