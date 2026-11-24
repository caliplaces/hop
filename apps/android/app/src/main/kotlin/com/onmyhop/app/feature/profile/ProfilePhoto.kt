package com.onmyhop.app.feature.profile

import androidx.core.graphics.createBitmap
import android.content.ContentResolver
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.ImageDecoder
import android.graphics.Paint
import android.graphics.Rect
import android.media.FaceDetector
import android.net.Uri
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.ByteArrayOutputStream
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

/**
 * Turns a picked photo into the profile photo Hop uploads: upright, square,
 * at most 512 pixels a side, as a JPEG holding only the picture. The square
 * is centred on the largest face, when there is one.
 *
 * The photo is redrawn, so the phone's location, camera details and any
 * other metadata stay on the phone. The server rebuilds it again anyway.
 */
object ProfilePhoto {
    /** The largest photo the app uploads, in pixels a side. */
    const val SIDE = 512

    /** The API refuses profile photos over this (MAX_AVATAR_BYTES). */
    const val MAX_BYTES = 512 * 1024

    class Unreadable : Exception("That photo can’t be used. Try another.")

    /** Prepares the photo at `uri`, in any format the system decodes (HEIC, JPEG, PNG…). */
    suspend fun prepare(resolver: ContentResolver, uri: Uri): ByteArray = withContext(Dispatchers.Default) {
        val upright = try {
            uprightImage(ImageDecoder.createSource(resolver, uri))
        } catch (error: Exception) {
            throw Unreadable()
        }
        val square = squareCrop(upright, largestFace(upright))
        encode(square)
    }

    /**
     * The photo with its orientation applied, scaled so its short side is
     * about [SIDE] pixels (never larger than it was, nor over 4096 long).
     */
    private fun uprightImage(source: ImageDecoder.Source): Bitmap =
        ImageDecoder.decodeBitmap(source) { decoder, info, _ ->
            val (width, height) = info.size.width to info.size.height
            if (width <= 0 || height <= 0) throw Unreadable()
            val short = min(width, height)
            val long = max(width, height)
            val wantedLong = min(min((SIDE.toDouble() * long / short).roundToInt(), long), 4096)
            val scale = wantedLong.toDouble() / long
            decoder.setTargetSize(max(1, (width * scale).roundToInt()), max(1, (height * scale).roundToInt()))
            decoder.allocator = ImageDecoder.ALLOCATOR_SOFTWARE
            decoder.isMutableRequired = false
        }

    /** The centre of the largest face, in the bitmap's pixels, if the system finds one. */
    private fun largestFace(image: Bitmap): Pair<Float, Float>? = runCatching {
        // The face detector needs RGB 565 and an even width.
        val width = image.width - image.width % 2
        if (width < 2 || image.height < 2) return null
        val copy = createBitmap(width, image.height, Bitmap.Config.RGB_565)
        Canvas(copy).drawBitmap(image, 0f, 0f, Paint(Paint.FILTER_BITMAP_FLAG))
        val faces = arrayOfNulls<FaceDetector.Face>(MAX_FACES)
        val found = FaceDetector(copy.width, copy.height, MAX_FACES).findFaces(copy, faces)
        copy.recycle()
        val face = faces.take(found).filterNotNull().maxByOrNull { it.eyesDistance() } ?: return null
        val midpoint = android.graphics.PointF()
        face.getMidPoint(midpoint)
        // The midpoint is between the eyes; the face's centre is a little lower.
        midpoint.x to midpoint.y + face.eyesDistance() * 0.4f
    }.getOrNull()

    /** A square inside a photo: its top-left corner and side, in pixels. */
    data class Square(val x: Int, val y: Int, val side: Int)

    /** The largest square that fits, centred on the face if any, else on the middle. */
    fun square(width: Int, height: Int, face: Pair<Float, Float>?): Square {
        val side = min(width, height)
        var x = (width - side) / 2
        var y = (height - side) / 2
        if (face != null) {
            x = (face.first - side / 2f).roundToInt().coerceIn(0, width - side)
            y = (face.second - side / 2f).roundToInt().coerceIn(0, height - side)
        }
        return Square(x, y, side)
    }

    private fun squareCrop(image: Bitmap, face: Pair<Float, Float>?): Bitmap {
        val square = square(image.width, image.height, face)
        val rect = Rect(square.x, square.y, square.x + square.side, square.y + square.side)
        val side = min(square.side, SIDE)
        val out = createBitmap(side, side)
        Canvas(out).apply {
            // Opaque: a transparent PNG would turn black in a JPEG.
            drawColor(Color.WHITE)
            drawBitmap(image, rect, Rect(0, 0, side, side), Paint(Paint.FILTER_BITMAP_FLAG))
        }
        return out
    }

    /** Encodes the square, lowering the quality if it would be too large. */
    private fun encode(square: Bitmap): ByteArray {
        for (quality in listOf(82, 65, 45)) {
            val stream = ByteArrayOutputStream()
            if (!square.compress(Bitmap.CompressFormat.JPEG, quality, stream)) throw Unreadable()
            if (stream.size() <= MAX_BYTES) return stream.toByteArray()
        }
        throw Unreadable()
    }

    private const val MAX_FACES = 4
}
