package com.dshremote.app.ui.theme

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp

/**
 * Primitive layer: raw values, no semantics.
 *
 * v7 rewrite: zinc neutrals + indigo primary, per the ratified redesign
 * (Linear/Raycast console idiom; 90% of the UI must not use Primary).
 * Success/warning/danger companions are standard tints derived for text
 * contrast — the approved ramp only defined hues, so companions are marked
 * derived and must be re-measured in QA.
 */
internal object Primitive {
    // Indigo primary: reserved for selected / active / focus / CTA.
    val indigo = Color(0xFF6366F1)
    val indigoSoft = Color(0xFFEEF2FF)
    val indigoInk = Color(0xFF1E1B4B)
    val indigoDark = Color(0xFFA5B4FC)
    val indigoDarkInk = Color(0xFF312E81)

    // Success greens (mint pill: bright bg + near-black text, high contrast).
    val greenPrimary = Color(0xFF006242)
    val greenFixed = Color(0xFF6FFBBE)
    val greenOnFixed = Color(0xFF002113)

    // Zinc neutrals, light.
    val zincBg = Color(0xFFFAFAFA)
    val zincSurface = Color(0xFFFFFFFF)
    val zincLow = Color(0xFFF4F4F5)
    val zincContainer = Color(0xFFEDEDEF)
    val zincHigh = Color(0xFFE4E4E7)
    val zincText = Color(0xFF18181B)
    val zincSecondary = Color(0xFF71717A)
    val zincTertiary = Color(0xFFA1A1AA)
    val zincOutline = Color(0xFFD4D4D8)

    // Zinc neutrals, dark (derived).
    val zincDarkBg = Color(0xFF09090B)
    val zincDarkSurface = Color(0xFF101014)
    val zincDarkLow = Color(0xFF17171C)
    val zincDarkContainer = Color(0xFF1D1D24)
    val zincDarkHigh = Color(0xFF27272E)
    val zincDarkText = Color(0xFFFAFAFA)
    val zincDarkSecondary = Color(0xFFA1A1AA)
    val zincDarkTertiary = Color(0xFF71717A)
    val zincDarkOutline = Color(0xFF3F3F46)

    // Dark tertiary companions, derived (prototype is light-only).
    val darkTertiary = Color(0xFF6FFBBE)
    val darkOnTertiary = Color(0xFF002113)

    // Feedback companions, derived for contrast (see header note).
    val successText = Color(0xFF15803D)
    val successBg = Color(0xFFE7F6EC)
    val successTextDark = Color(0xFF4ADE80)
    val successBgDark = Color(0xFF052E16)
    val dangerText = Color(0xFFDC2626)
    val dangerBg = Color(0xFFFEE2E2)
    val dangerTextDark = Color(0xFFFCA5A5)
    val dangerBgDark = Color(0xFF450A0A)
    val warnText = Color(0xFFB45309)
    val warnBg = Color(0xFFFEF3C7)
    val warnTextDark = Color(0xFFFCD34D)
    val warnBgDark = Color(0xFF451A03)
}

/** Spacing scale: the only source of paddings and gaps. */
object Spacing {
    val s1 = 4.dp
    val s2 = 8.dp
    val s3 = 12.dp
    val s4 = 16.dp
    val s5 = 24.dp
    val s6 = 32.dp
}

/**
 * Radius scale, component-mapped (no generic small/medium: every radius names
 * its consumer so drift is visible at the call site).
 */
object Radius {
    val button = 10.dp
    val input = 12.dp
    val card = 14.dp
    val dialog = 20.dp
    val sheet = 24.dp
}

/** Motion scale: durations only; curves live in Theme.kt next to usage. */
object Motion {
    const val instant = 80
    const val fast = 150
    const val base = 250
}
