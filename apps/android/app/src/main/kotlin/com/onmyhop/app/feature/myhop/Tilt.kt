package com.onmyhop.app.feature.myhop

import android.content.Context
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
 * How the phone is tilting, -1…1 on each axis, for the Hop pass's foil.
 *
 * It's relative to how the phone is being held: the resting pose slowly
 * follows it, so tilting the phone moves the foil and holding it still lets
 * it settle back, whatever the angle. Zero when animations are off.
 */
@Composable
fun rememberTilt(): State<Offset> {
    val context = LocalContext.current
    val tilt = remember { mutableStateOf(Offset.Zero) }
    val reduceMotion = remember { animationsOff(context) }
    DisposableEffect(reduceMotion) {
        val sensors = context.getSystemService(Context.SENSOR_SERVICE) as SensorManager
        val gravity = sensors.getDefaultSensor(Sensor.TYPE_GRAVITY)
        if (reduceMotion || gravity == null) return@DisposableEffect onDispose {}
        var rest: Offset? = null
        val listener = object : SensorEventListener {
            override fun onSensorChanged(event: SensorEvent) {
                // Gravity across the screen, in g, like the iPhone's (x right, y up).
                val now = Offset(-event.values[0] / SensorManager.GRAVITY_EARTH, -event.values[1] / SensorManager.GRAVITY_EARTH)
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

/** The system's "Remove animations" setting: animator duration scale off. */
fun animationsOff(context: Context): Boolean =
    Settings.Global.getFloat(context.contentResolver, Settings.Global.ANIMATOR_DURATION_SCALE, 1f) == 0f

object TiltMath {
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
