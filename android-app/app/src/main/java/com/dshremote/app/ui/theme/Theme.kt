package com.dshremote.app.ui.theme

import androidx.compose.animation.core.CubicBezierEasing
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Shapes
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp

private val LightScheme = lightColorScheme(
    primary = Primitive.indigo,
    onPrimary = Color.White,
    primaryContainer = Primitive.indigoSoft,
    onPrimaryContainer = Primitive.indigoInk,
    surface = Primitive.zincSurface,
    onSurface = Primitive.zincText,
    surfaceContainerLowest = Primitive.zincSurface,
    surfaceContainerLow = Primitive.zincLow,
    surfaceContainer = Primitive.zincContainer,
    surfaceContainerHigh = Primitive.zincHigh,
    surfaceContainerHighest = Primitive.zincHigh,
    onSurfaceVariant = Primitive.zincSecondary,
    outline = Primitive.zincOutline,
    outlineVariant = Primitive.zincHigh,
    error = Primitive.dangerText,
    onError = Color.White,
    errorContainer = Primitive.dangerBg,
    onErrorContainer = Primitive.dangerText,
    tertiary = Primitive.greenPrimary,
    onTertiary = Color.White,
    tertiaryContainer = Primitive.greenFixed,
    onTertiaryContainer = Primitive.greenOnFixed,
    background = Primitive.zincBg,
    onBackground = Primitive.zincText,
)

private val DarkScheme = darkColorScheme(
    primary = Primitive.indigoDark,
    onPrimary = Primitive.indigoDarkInk,
    primaryContainer = Primitive.indigoDarkInk,
    onPrimaryContainer = Primitive.indigoDark,
    surface = Primitive.zincDarkSurface,
    onSurface = Primitive.zincDarkText,
    surfaceContainerLowest = Primitive.zincDarkSurface,
    surfaceContainerLow = Primitive.zincDarkLow,
    surfaceContainer = Primitive.zincDarkContainer,
    surfaceContainerHigh = Primitive.zincDarkHigh,
    surfaceContainerHighest = Primitive.zincDarkHigh,
    onSurfaceVariant = Primitive.zincDarkSecondary,
    outline = Primitive.zincDarkOutline,
    outlineVariant = Primitive.zincDarkOutline,
    error = Primitive.dangerTextDark,
    onError = Primitive.zincDarkBg,
    errorContainer = Primitive.dangerBgDark,
    onErrorContainer = Primitive.dangerTextDark,
    tertiary = Primitive.darkTertiary,
    onTertiary = Primitive.darkOnTertiary,
    tertiaryContainer = Primitive.darkOnTertiary,
    onTertiaryContainer = Primitive.darkTertiary,
    background = Primitive.zincDarkBg,
    onBackground = Primitive.zincDarkText,
)

private val AppTypography = Typography(
    displaySmall = TextStyle(
        fontSize = 28.sp, lineHeight = 34.sp, fontWeight = FontWeight.Bold,
    ),
    headlineSmall = TextStyle(
        fontSize = 22.sp, lineHeight = 28.sp, fontWeight = FontWeight.Bold,
    ),
    titleMedium = TextStyle(
        fontSize = 18.sp, lineHeight = 24.sp, fontWeight = FontWeight.SemiBold,
    ),
    titleSmall = TextStyle(
        fontSize = 16.sp, lineHeight = 22.sp, fontWeight = FontWeight.SemiBold,
    ),
    bodyLarge = TextStyle(
        fontSize = 16.sp, lineHeight = 24.sp, fontWeight = FontWeight.Normal,
    ),
    bodyMedium = TextStyle(
        fontSize = 14.sp, lineHeight = 20.sp, fontWeight = FontWeight.Normal,
    ),
    bodySmall = TextStyle(
        fontSize = 13.sp, lineHeight = 18.sp, fontWeight = FontWeight.Normal,
    ),
    labelMedium = TextStyle(
        fontSize = 12.sp, lineHeight = 16.sp, fontWeight = FontWeight.SemiBold,
    ),
    labelSmall = TextStyle(
        fontSize = 11.sp, lineHeight = 14.sp, fontWeight = FontWeight.Medium,
    ),
)

private val AppShapes = Shapes(
    small = RoundedCornerShape(Radius.button),
    medium = RoundedCornerShape(Radius.card),
    large = RoundedCornerShape(Radius.sheet),
)

/** Shared easing: elements moving on screen. Enter uses the platform default. */
val EasingStandard = CubicBezierEasing(0.2f, 0.0f, 0.0f, 1.0f)

@Composable
fun AppTheme(content: @Composable () -> Unit) {
    val dark = isSystemInDarkTheme()
    MaterialTheme(
        colorScheme = if (dark) DarkScheme else LightScheme,
        typography = AppTypography,
        shapes = AppShapes,
        content = content,
    )
}

/** Monospace for pairing codes, model ids and code spans. */
val MonoFamily = FontFamily.Monospace
