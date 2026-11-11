# Pins 2

```kts
val kotlinVersion = "2.0.0"

plugins {
    kotlin("android") version kotlinVersion
}

dependencies {
    testImplementation("org.robolectric:robolectric") { version { strictly("4.10") } }
    testImplementation(
        group = "junit",
        name = "junit",
        version = "4.12",
    )
    testImplementation("com.google.truth:truth") {
        version {
            prefer("1.0")
        }
    }
}
```

```toml
[libraries]
a = { module = 'org.robolectric:robolectric', version = '4.10' }
e.module = "androidx.compose:compose-bom"
e.version = "2024.01.00"
```
