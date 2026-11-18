package com.onmyhop.app.design

import android.app.UiModeManager
import android.content.Context
import android.os.Build
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.AnimationSpec
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.ColorScheme
import androidx.compose.material3.MaterialExpressiveTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.MotionScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import com.materialkolor.dynamiccolor.ColorSpec
import com.materialkolor.hct.Hct
import com.materialkolor.scheme.DynamicScheme
import com.materialkolor.scheme.SchemeTonalSpot

/** The athlete whose colour the screen wears: for accents only, like the iPhone app. */
val LocalAthleteColor = staticCompositionLocalOf { Palette.brand }

/**
 * Hop's theme: Material 3 Expressive, with a full tonal colour scheme grown
 * from the athlete's colour (Hop's own grape until they pick one), in the
 * system's light or dark appearance and contrast. The scheme keeps chrome
 * calm; the exact colour is in [LocalAthleteColor] for the moments that
 * should wear it, such as the pass and Event mode.
 */
@Composable
fun HopTheme(color: PaletteColor = Palette.brand, content: @Composable () -> Unit) {
    val dark = isSystemInDarkTheme()
    val contrast = systemContrast()
    val target = remember(color, dark, contrast) { hopColorScheme(color.hex, dark, contrast.toDouble()) }
    val motion = MotionScheme.expressive()
    val scheme = target.animated(motion.defaultEffectsSpec())
    CompositionLocalProvider(LocalAthleteColor provides color) {
        MaterialExpressiveTheme(colorScheme = scheme, motionScheme = motion, content = content)
    }
}

/** The scheme for one seed colour, from Material's own colour science (the 2025 spec). */
fun hopColorScheme(seed: Int, dark: Boolean, contrast: Double = 0.0): ColorScheme {
    val scheme: DynamicScheme = SchemeTonalSpot(
        sourceColorHct = Hct.fromInt(0xFF000000.toInt() or seed),
        isDark = dark,
        contrastLevel = contrast,
        specVersion = ColorSpec.SpecVersion.SPEC_2025,
    )
    fun c(argb: Int) = Color(argb)
    return ColorScheme(
        primary = c(scheme.primary),
        onPrimary = c(scheme.onPrimary),
        primaryContainer = c(scheme.primaryContainer),
        onPrimaryContainer = c(scheme.onPrimaryContainer),
        inversePrimary = c(scheme.inversePrimary),
        secondary = c(scheme.secondary),
        onSecondary = c(scheme.onSecondary),
        secondaryContainer = c(scheme.secondaryContainer),
        onSecondaryContainer = c(scheme.onSecondaryContainer),
        tertiary = c(scheme.tertiary),
        onTertiary = c(scheme.onTertiary),
        tertiaryContainer = c(scheme.tertiaryContainer),
        onTertiaryContainer = c(scheme.onTertiaryContainer),
        background = c(scheme.background),
        onBackground = c(scheme.onBackground),
        surface = c(scheme.surface),
        onSurface = c(scheme.onSurface),
        surfaceVariant = c(scheme.surfaceVariant),
        onSurfaceVariant = c(scheme.onSurfaceVariant),
        surfaceTint = c(scheme.surfaceTint),
        inverseSurface = c(scheme.inverseSurface),
        inverseOnSurface = c(scheme.inverseOnSurface),
        error = c(scheme.error),
        onError = c(scheme.onError),
        errorContainer = c(scheme.errorContainer),
        onErrorContainer = c(scheme.onErrorContainer),
        outline = c(scheme.outline),
        outlineVariant = c(scheme.outlineVariant),
        scrim = c(scheme.scrim),
        surfaceBright = c(scheme.surfaceBright),
        surfaceContainer = c(scheme.surfaceContainer),
        surfaceContainerHigh = c(scheme.surfaceContainerHigh),
        surfaceContainerHighest = c(scheme.surfaceContainerHighest),
        surfaceContainerLow = c(scheme.surfaceContainerLow),
        surfaceContainerLowest = c(scheme.surfaceContainerLowest),
        surfaceDim = c(scheme.surfaceDim),
        primaryFixed = c(scheme.primaryFixed),
        primaryFixedDim = c(scheme.primaryFixedDim),
        onPrimaryFixed = c(scheme.onPrimaryFixed),
        onPrimaryFixedVariant = c(scheme.onPrimaryFixedVariant),
        secondaryFixed = c(scheme.secondaryFixed),
        secondaryFixedDim = c(scheme.secondaryFixedDim),
        onSecondaryFixed = c(scheme.onSecondaryFixed),
        onSecondaryFixedVariant = c(scheme.onSecondaryFixedVariant),
        tertiaryFixed = c(scheme.tertiaryFixed),
        tertiaryFixedDim = c(scheme.tertiaryFixedDim),
        onTertiaryFixed = c(scheme.onTertiaryFixed),
        onTertiaryFixedVariant = c(scheme.onTertiaryFixedVariant),
    )
}

/** The system's contrast setting (Android 14+), from -1 to 1; 0 elsewhere. */
@Composable
private fun systemContrast(): Float {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.UPSIDE_DOWN_CAKE) return 0f
    val context = LocalContext.current
    val uiModeManager = remember(context) { context.getSystemService(Context.UI_MODE_SERVICE) as UiModeManager }
    val contrast = remember { mutableFloatStateOf(uiModeManager.contrast) }
    DisposableEffect(uiModeManager) {
        val listener = UiModeManager.ContrastChangeListener { contrast.floatValue = it }
        uiModeManager.addContrastChangeListener(context.mainExecutor, listener)
        onDispose { uiModeManager.removeContrastChangeListener(listener) }
    }
    return contrast.floatValue
}

/** Eases every role to its new colour, so picking a colour washes over the screen. */
@Composable
private fun ColorScheme.animated(spec: AnimationSpec<Color>): ColorScheme {
    @Composable
    fun Color.eased(): Color = animateColorAsState(this, spec, label = "scheme").value
    return ColorScheme(
        primary = primary.eased(),
        onPrimary = onPrimary.eased(),
        primaryContainer = primaryContainer.eased(),
        onPrimaryContainer = onPrimaryContainer.eased(),
        inversePrimary = inversePrimary.eased(),
        secondary = secondary.eased(),
        onSecondary = onSecondary.eased(),
        secondaryContainer = secondaryContainer.eased(),
        onSecondaryContainer = onSecondaryContainer.eased(),
        tertiary = tertiary.eased(),
        onTertiary = onTertiary.eased(),
        tertiaryContainer = tertiaryContainer.eased(),
        onTertiaryContainer = onTertiaryContainer.eased(),
        background = background.eased(),
        onBackground = onBackground.eased(),
        surface = surface.eased(),
        onSurface = onSurface.eased(),
        surfaceVariant = surfaceVariant.eased(),
        onSurfaceVariant = onSurfaceVariant.eased(),
        surfaceTint = surfaceTint.eased(),
        inverseSurface = inverseSurface.eased(),
        inverseOnSurface = inverseOnSurface.eased(),
        error = error,
        onError = onError,
        errorContainer = errorContainer,
        onErrorContainer = onErrorContainer,
        outline = outline.eased(),
        outlineVariant = outlineVariant.eased(),
        scrim = scrim,
        surfaceBright = surfaceBright.eased(),
        surfaceContainer = surfaceContainer.eased(),
        surfaceContainerHigh = surfaceContainerHigh.eased(),
        surfaceContainerHighest = surfaceContainerHighest.eased(),
        surfaceContainerLow = surfaceContainerLow.eased(),
        surfaceContainerLowest = surfaceContainerLowest.eased(),
        surfaceDim = surfaceDim.eased(),
        primaryFixed = primaryFixed.eased(),
        primaryFixedDim = primaryFixedDim.eased(),
        onPrimaryFixed = onPrimaryFixed.eased(),
        onPrimaryFixedVariant = onPrimaryFixedVariant.eased(),
        secondaryFixed = secondaryFixed.eased(),
        secondaryFixedDim = secondaryFixedDim.eased(),
        onSecondaryFixed = onSecondaryFixed.eased(),
        onSecondaryFixedVariant = onSecondaryFixedVariant.eased(),
        tertiaryFixed = tertiaryFixed.eased(),
        tertiaryFixedDim = tertiaryFixedDim.eased(),
        onTertiaryFixed = onTertiaryFixed.eased(),
        onTertiaryFixedVariant = onTertiaryFixedVariant.eased(),
    )
}

/** The athlete's colour, for accents. */
val MaterialTheme.athlete: PaletteColor
    @Composable get() = LocalAthleteColor.current
