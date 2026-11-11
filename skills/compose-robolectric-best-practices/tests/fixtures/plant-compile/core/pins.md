# Pins

Every version below differs from the harness pin, each in a form Gradle accepts.

```kts
plugins {
    kotlin("plugin.compose") version "2.0.0"
    id("com.android.application").version("8.0.0")
}

val robolectricVersion = "4.11"

dependencies {
    testImplementation(group = "org.robolectric", name = "robolectric", version = "4.10")
    testImplementation("org.robolectric:robolectric:${robolectricVersion}")
    testImplementation("junit:junit:$junitVersion")
}
```

```toml
[versions]
robolectric = "4.12"
truth = "1.0"

[libraries]
robolectric = { group = "org.robolectric", name = "robolectric", version.ref = "robolectric" }
junit = { module = "junit:junit", version = { strictly = "4.12" } }
truth = { module = "com.google.truth:truth" , version = { ref = "truth" } }
coroutines = { module = "org.jetbrains.kotlinx:kotlinx-coroutines-test" , version = "1.0" }

[plugins]
android-application = { id = "com.android.application", version = { prefer = "8.0.0" } }
```
