plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.compose)
    alias(libs.plugins.kotlin.serialization)
}

/**
 * Debug builds talk to staging. To use the API running on this computer
 * instead, set `hop.apiUrl` (in ~/.gradle/gradle.properties, or with
 * -Phop.apiUrl=...), such as http://10.0.2.2:8787 from the emulator.
 */
val debugApiUrl = providers.gradleProperty("hop.apiUrl").orElse("https://staging.onmyhop.com")

/**
 * Firebase, for push notifications: each environment's own project, from
 * `hop.firebase.<staging|production>.<appId|projectId|apiKey|senderId>` (in
 * ~/.gradle/gradle.properties, never in the repository). Debug builds use
 * staging's, release builds production's. Without them, a build has no push
 * notifications.
 */
fun firebase(environment: String): Map<String, String> =
    listOf("appId", "projectId", "apiKey", "senderId").associateWith { field ->
        providers.gradleProperty("hop.firebase.$environment.$field").orElse("").get()
    }

fun com.android.build.api.dsl.ApplicationBuildType.firebaseFrom(environment: String) {
    val settings = firebase(environment)
    val complete = settings.values.all { it.isNotBlank() }
    for ((field, value) in settings) {
        val name = "FIREBASE_" + field.replace(Regex("([A-Z])"), "_$1").uppercase()
        buildConfigField("String", name, "\"${if (complete) value else ""}\"")
    }
    // The messaging service is there only when there's Firebase to receive from.
    resValue("bool", "push_enabled", complete.toString())
}

android {
    namespace = "com.onmyhop.app"
    compileSdk = 37

    defaultConfig {
        applicationId = "com.onmyhop.app"
        minSdk = 29
        targetSdk = 36
        versionCode = 1
        versionName = "1.0"
    }

    buildTypes {
        debug {
            buildConfigField("String", "API_URL", "\"${debugApiUrl.get()}\"")
            firebaseFrom("staging")
        }
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            buildConfigField("String", "API_URL", "\"https://onmyhop.com\"")
            firebaseFrom("production")
        }
    }

    buildFeatures {
        compose = true
        buildConfig = true
        resValues = true
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    testOptions {
        unitTests.isReturnDefaultValues = true
    }

    packaging {
        resources.excludes += "/META-INF/{AL2.0,LGPL2.1}"
    }
}

kotlin {
    compilerOptions {
        optIn.addAll(
            "androidx.compose.material3.ExperimentalMaterial3Api",
            "androidx.compose.material3.ExperimentalMaterial3ExpressiveApi",
        )
    }
}

dependencies {
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.core.splashscreen)
    implementation(libs.androidx.activity.compose)
    implementation(libs.androidx.browser)
    implementation(libs.androidx.lifecycle.runtime.compose)
    implementation(libs.androidx.lifecycle.viewmodel.compose)
    implementation(libs.androidx.lifecycle.viewmodel.navigation3)
    implementation(libs.androidx.navigation3.runtime)
    implementation(libs.androidx.navigation3.ui)

    implementation(platform(libs.compose.bom))
    implementation(libs.compose.ui)
    implementation(libs.compose.ui.graphics)
    implementation(libs.compose.ui.tooling.preview)
    implementation(libs.compose.material3)
    implementation(libs.compose.material3.navigation.suite)
    implementation(libs.color.utilities)
    debugImplementation(libs.compose.ui.tooling)

    implementation(libs.kotlinx.coroutines.android)
    implementation(libs.kotlinx.serialization.json)
    implementation(libs.okhttp)
    implementation(libs.coil.compose)
    implementation(libs.coil.network.okhttp)
    implementation(libs.media3.exoplayer)
    implementation(libs.media3.ui.compose.material3)
    implementation(libs.zxing.core)
    implementation(libs.glance.appwidget)
    implementation(platform(libs.firebase.bom))
    implementation(libs.firebase.messaging)

    testImplementation(libs.junit)
    testImplementation(libs.kotlinx.coroutines.test)
    testImplementation(libs.okhttp.mockwebserver)
    testImplementation(libs.turbine)
}
