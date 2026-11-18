package com.onmyhop.app.design

import android.graphics.Bitmap
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.core.graphics.createBitmap
import androidx.core.graphics.set
import com.google.zxing.BarcodeFormat
import com.google.zxing.EncodeHintType
import com.google.zxing.common.BitMatrix
import com.google.zxing.qrcode.QRCodeWriter
import com.google.zxing.qrcode.decoder.ErrorCorrectionLevel

/** QR codes for the athlete's link, as modules: black on white, always, so they scan. */
object QrCodes {
    /** The code's modules, without a quiet zone (the composable and the image add their own). */
    fun matrix(text: String): BitMatrix =
        QRCodeWriter().encode(
            text,
            BarcodeFormat.QR_CODE,
            0,
            0,
            mapOf(EncodeHintType.ERROR_CORRECTION to ErrorCorrectionLevel.M, EncodeHintType.MARGIN to 0),
        )

    /**
     * The code as an image, for saving or a widget: [moduleSize] pixels a
     * module, with a 4-module white border, its corners rounded by
     * [cornerModules] modules (transparent beyond them).
     */
    fun bitmap(text: String, moduleSize: Int = 24, cornerModules: Float = 0f): Bitmap {
        val matrix = matrix(text)
        val quiet = 4
        val side = (matrix.width + quiet * 2) * moduleSize
        val bitmap = createBitmap(side, side)
        if (cornerModules > 0f) {
            val radius = cornerModules * moduleSize
            android.graphics.Canvas(bitmap).drawRoundRect(
                0f, 0f, side.toFloat(), side.toFloat(), radius, radius,
                android.graphics.Paint(android.graphics.Paint.ANTI_ALIAS_FLAG).apply { color = android.graphics.Color.WHITE },
            )
        } else {
            bitmap.eraseColor(android.graphics.Color.WHITE)
        }
        for (y in 0 until matrix.height) {
            for (x in 0 until matrix.width) {
                if (!matrix[x, y]) continue
                for (dy in 0 until moduleSize) {
                    for (dx in 0 until moduleSize) {
                        bitmap[(x + quiet) * moduleSize + dx, (y + quiet) * moduleSize + dy] = android.graphics.Color.BLACK
                    }
                }
            }
        }
        return bitmap
    }
}

/** The link as a QR code on a white card, black on white whatever the theme, so it always scans. */
@Composable
fun QrCode(text: String, description: String, modifier: Modifier = Modifier, padding: Dp = 12.dp, cornerRadius: Dp = 22.dp) {
    val matrix = remember(text) { QrCodes.matrix(text) }
    Box(
        modifier
            .aspectRatio(1f)
            .clip(RoundedCornerShape(cornerRadius))
            .background(Color.White)
            .padding(padding)
            .semantics { contentDescription = description },
    ) {
        Canvas(Modifier.fillMaxSize()) {
            val module = size.width / matrix.width
            for (y in 0 until matrix.height) {
                for (x in 0 until matrix.width) {
                    if (!matrix[x, y]) continue
                    // A hair over a module, so neighbours meet without seams.
                    drawRect(Color.Black, Offset(x * module, y * module), Size(module + 0.5f, module + 0.5f))
                }
            }
        }
    }
}
