package com.onmyhop.app.feature.myhop

import android.content.ClipData
import android.content.ContentValues
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.os.Environment
import android.provider.MediaStore
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.requiredSize
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.graphics.layer.GraphicsLayer
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.dp
import androidx.core.content.FileProvider
import com.onmyhop.app.core.Me
import com.onmyhop.app.design.QrCodes
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.HttpUrl
import java.io.File
import java.io.IOException

/**
 * Draws the pass's story, 1080 × 1920 pixels, into [layer] without showing
 * it, so it can be shared as an image the moment it's asked for.
 */
@Composable
fun StoryCapture(me: Me, link: HttpUrl, stats: PassStats?, layer: GraphicsLayer) {
    Box(Modifier.size(0.dp)) {
        // 360 × 640 at three pixels a point, whatever this phone's density and text size.
        CompositionLocalProvider(LocalDensity provides Density(density = 3f, fontScale = 1f)) {
            Box(
                Modifier
                    .requiredSize(360.dp, 640.dp)
                    .drawWithContent { layer.record { this@drawWithContent.drawContent() } },
            ) {
                PassStory(me, link, stats, Modifier.fillMaxSize())
            }
        }
    }
}

object PassImages {
    /** Shares an image, such as the pass's story, through the share sheet. */
    suspend fun share(context: Context, image: Bitmap, title: String) {
        val file = withContext(Dispatchers.IO) {
            val dir = File(context.cacheDir, "shared/pass").apply { mkdirs() }
            File(dir, "hop-pass.png").apply { outputStream().use { image.compress(Bitmap.CompressFormat.PNG, 100, it) } }
        }
        val uri = FileProvider.getUriForFile(context, "${context.packageName}.files", file)
        val send = Intent(Intent.ACTION_SEND)
            .setType("image/png")
            .putExtra(Intent.EXTRA_STREAM, uri)
            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        send.clipData = ClipData.newRawUri(null, uri)
        context.startActivity(Intent.createChooser(send, title).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION))
    }

    /** Saves the link's QR code to the gallery, in Pictures/Hop. No permission needed. */
    suspend fun saveQrCode(context: Context, me: Me, link: HttpUrl) = withContext(Dispatchers.IO) {
        val resolver = context.contentResolver
        val values = ContentValues().apply {
            put(MediaStore.MediaColumns.DISPLAY_NAME, "Hop QR code ${me.handle ?: ""}".trim() + ".png")
            put(MediaStore.MediaColumns.MIME_TYPE, "image/png")
            put(MediaStore.MediaColumns.RELATIVE_PATH, "${Environment.DIRECTORY_PICTURES}/Hop")
            put(MediaStore.MediaColumns.IS_PENDING, 1)
        }
        val uri = resolver.insert(MediaStore.Images.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY), values)
            ?: throw IOException("Couldn’t save to this phone.")
        try {
            resolver.openOutputStream(uri)?.use { QrCodes.bitmap(link.toString()).compress(Bitmap.CompressFormat.PNG, 100, it) }
                ?: throw IOException("Couldn’t save to this phone.")
            resolver.update(uri, ContentValues().apply { put(MediaStore.MediaColumns.IS_PENDING, 0) }, null, null)
        } catch (error: Throwable) {
            resolver.delete(uri, null, null)
            throw error
        }
    }
}
