package com.onmyhop.app.feature.myhop

import android.content.Context
import androidx.compose.ui.platform.LocalView
import android.view.Surface
import android.os.Looper
import android.os.Handler
import android.database.ContentObserver
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import android.provider.Settings
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.State
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.platform.LocalContext
import kotlin.math.max
import kotlin.math.min

/**
 * How the phone is tilting, -1…1 on each axis of the screen, for the Hop
 * pass's foil.
 *
 * It's relative to how the phone is being held: the resting pose slowly
 * follows it, so tilting the phone moves the foil and holding it still lets
 * it settle back, whatever the angle. Zero while [still].
 */
@Composable
fun rememberTilt(still: Boolean): State<Offset> {
    val context = LocalContext.current
    val view = LocalView.current
    val tilt = remember { mutableStateOf(Offset.Zero) }
    DisposableEffect(still) {
        val sensors = context.getSystemService(Context.SENSOR_SERVICE) as SensorManager
        val gravity = sensors.getDefaultSensor(Sensor.TYPE_GRAVITY)
        if (still || gravity == null) {
            tilt.value = Offset.Zero
            return@DisposableEffect onDispose {}
        }
        var rest: Offset? = null
        val listener = object : SensorEventListener {
            override fun onSensorChanged(event: SensorEvent) {
                // The sensor's axes are the phone's; the pass turns with the screen's.
                val rotation = view.display?.rotation ?: Surface.ROTATION_0
                val now = TiltMath.screenGravity(event.values[0], event.values[1], rotation)
                val (value, settled) = TiltMath.step(now, rest ?: now)
                rest = settled
                tilt.value = value
            }

            override fun onAccuracyChanged(sensor: Sensor?, accuracy: Int) = Unit
        }
        sensors.registerListener(listener, gravity, SensorManager.SENSOR_DELAY_GAME)
        onDispose {
            sensors.unregisterListener(listener)
            tilt.value = Offset.Zero
        }
    }
    return tilt
}

/**
 * The system's "Remove animations" setting (animator duration scale off),
 * kept up to date if it's changed in Settings while the pass is showing.
 */
@Composable
fun rememberAnimationsOff(): State<Boolean> {
    val context = LocalContext.current
    val off = remember { mutableStateOf(animationsOff(context)) }
    DisposableEffect(context) {
        val observer = object : ContentObserver(Handler(Looper.getMainLooper())) {
            override fun onChange(selfChange: Boolean) {
                off.value = animationsOff(context)
            }
        }
        context.contentResolver.registerContentObserver(
            Settings.Global.getUriFor(Settings.Global.ANIMATOR_DURATION_SCALE),
            false,
            observer,
        )
        onDispose { context.contentResolver.unregisterContentObserver(observer) }
    }
    return off
}

/** The system's "Remove animations" setting: animator duration scale off. */
fun animationsOff(context: Context): Boolean =
    Settings.Global.getFloat(context.contentResolver, Settings.Global.ANIMATOR_DURATION_SCALE, 1f) == 0f

object TiltMath {
    /**
     * Gravity across the screen, in g (x right, y up, like the iPhone's), from
     * the sensor's readings along the phone's own axes and how the screen is
     * turned.
     */
    fun screenGravity(x: Float, y: Float, rotation: Int): Offset {
        val (screenX, screenY) = when (rotation) {
            Surface.ROTATION_90 -> -y to x
            Surface.ROTATION_180 -> -x to -y
            Surface.ROTATION_270 -> y to -x
            else -> x to y
        }
        return Offset(-screenX / SensorManager.GRAVITY_EARTH, -screenY / SensorManager.GRAVITY_EARTH)
    }

    /** Gravity this far from the resting pose is a full tilt. */
    const val RANGE = 0.35f

    /** How quickly the resting pose catches up with the phone, per update. */
    const val SETTLE = 0.025f

    /** One update: the tilt relative to the resting pose, and the resting pose moved towards now. */
    fun step(gravity: Offset, rest: Offset): Pair<Offset, Offset> {
        fun clamp(v: Float) = max(-1f, min(1f, v))
        val tilt = Offset(clamp((gravity.x - rest.x) / RANGE), clamp((gravity.y - rest.y) / RANGE))
        val settled = Offset(rest.x + (gravity.x - rest.x) * SETTLE, rest.y + (gravity.y - rest.y) * SETTLE)
        return tilt to settled
    }
}
