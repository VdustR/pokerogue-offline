plugins {
    id("com.android.application")
}

val generatedVersionCode = providers.gradleProperty("pokerogueVersionCode").orElse("1")
val generatedVersionName = providers.gradleProperty("pokerogueVersionName").orElse("dev")

android {
    namespace = "dev.vdustr.pokerogue.offline"
    compileSdk = 36

    defaultConfig {
        applicationId = "dev.vdustr.pokerogue.offline"
        minSdk = 26
        targetSdk = 36
        versionCode = generatedVersionCode.get().toInt()
        versionName = generatedVersionName.get()
    }

    flavorDimensions += "edition"
    productFlavors {
        create("normal") {
            dimension = "edition"
            applicationIdSuffix = ".normal"
            resValue("string", "app_name", "PokéRogue Offline")
        }
        create("unlockAll") {
            dimension = "edition"
            applicationIdSuffix = ".unlockall"
            resValue("string", "app_name", "PokéRogue Unlock All")
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    buildFeatures {
        buildConfig = true
        resValues = true
    }

    androidResources {
        noCompress += setOf("m4a", "mp3", "mp4", "ogg", "wav", "webm")
    }

    lint {
        abortOnError = true
        checkReleaseBuilds = true
        warningsAsErrors = true
        // Keep CI deterministic on the latest stable, mutually supported Android toolchain.
        // The resource checks are false positives: adaptive icons need v26 XML, while the
        // generated official logo is staged before Gradle resource processing. PokéRogue
        // stays landscape while respecting the user's normal or reverse landscape preference.
        disable += setOf(
            "AndroidGradlePluginVersion",
            "GradleDependency",
            "DiscouragedApi",
            "MonochromeLauncherIcon",
            "ObsoleteSdkInt",
            "OldTargetApi",
        )
    }
}
