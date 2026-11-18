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
 * Firebase, for push notifications: one project for debug and release builds
 * alike, from `hop.firebase.<appId|projectId|apiKey|senderId>` (in
 * ~/.gradle/gradle.properties, never in the repository). Without them, a
 * build has no push notifications.
 */
fun com.android.build.api.dsl.VariantDimension.firebase() {
    val settings = listOf("appId", "projectId", "apiKey", "senderId").associateWith { field ->
        providers.gradleProperty("hop.firebase.$field").orElse("").get()
    }
    val complete = settings.values.all { it.isNotBlank() }
    for ((field, value) in settings) {
        val name = "FIREBASE_" + field.replace(Regex("([A-Z])"), "_$1").uppercase()
        buildConfigField("String", name, "\"${if (complete) value else ""}\"")
    }
    // The messaging service is there only when there's Firebase to receive from.
    resValue("bool", "push_enabled", complete.toString())
}

/**
 * The upload key release builds are signed with for Google Play, which signs
 * what it delivers with its own key. It comes from
 * `hop.upload.<storeFile|storePassword|keyAlias|keyPassword>` (in
 * ~/.gradle/gradle.properties, never in the repository). Without them,
 * release builds are unsigned.
 */
val upload = listOf("storeFile", "storePassword", "keyAlias", "keyPassword").associateWith { field ->
    providers.gradleProperty("hop.upload.$field").orElse("").get()
}

android {
    namespace = "com.onmyhop.app"
    compileSdk = 37

    defaultConfig {
        applicationId = "com.onmyhop.app"
        minSdk = 29
        targetSdk = 36
        // Each upload to Play needs a higher one: -Phop.versionCode=<yyyymmdd><n>,
        // like the iPhone app's build numbers.
        versionCode = providers.gradleProperty("hop.versionCode").orElse("1").get().toInt()
        versionName = "1.0.0"
        firebase()
    }

    signingConfigs {
        if (upload.values.all { it.isNotBlank() }) {
            create("upload") {
                storeFile = file(upload.getValue("storeFile"))
                storePassword = upload.getValue("storePassword")
                keyAlias = upload.getValue("keyAlias")
                keyPassword = upload.getValue("keyPassword")
            }
        }
    }

    buildTypes {
        debug {
            buildConfigField("String", "API_URL", "\"${debugApiUrl.get()}\"")
        }
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            buildConfigField("String", "API_URL", "\"https://onmyhop.com\"")
            signingConfig = signingConfigs.findByName("upload")
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
    // Glance brings WorkManager 2.7.1, whose Room R8 strips the database out
    // of: release builds crashed at launch. A current one keeps what it needs.
    implementation(libs.androidx.work.runtime)
    implementation(platform(libs.firebase.bom))
    implementation(libs.firebase.messaging)
    implementation(libs.play.billing)

    testImplementation(libs.junit)
    testImplementation(libs.kotlinx.coroutines.test)
    testImplementation(libs.okhttp.mockwebserver)
    testImplementation(libs.turbine)
}
