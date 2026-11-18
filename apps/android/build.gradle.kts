plugins {
    alias(libs.plugins.android.application) apply false
    // AGP builds Kotlin itself; this only picks the Kotlin version it uses.
    alias(libs.plugins.kotlin.android) apply false
    alias(libs.plugins.kotlin.compose) apply false
    alias(libs.plugins.kotlin.serialization) apply false
}
