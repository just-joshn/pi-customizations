# Setup and Configuration

## Table of Contents

1. [Gradle Setup](#gradle-setup)
2. [Why Each Piece Is There](#why-each-piece-is-there)
3. [Version Catalog](#version-catalog)
4. [Running the Tests](#running-the-tests)
5. [A First Test](#a-first-test)
6. [@Config and robolectric.properties](#config-and-robolectricproperties)
7. [Choosing SDK Levels](#choosing-sdk-levels)
8. [Qualifiers and the Default Device](#qualifiers-and-the-default-device)
9. [Custom Application Class](#custom-application-class)
10. [Looper and Graphics Modes](#looper-and-graphics-modes)
11. [Anti-Patterns](#anti-patterns)
12. [Troubleshooting](#troubleshooting)

## Gradle Setup

Compose UI tests under Robolectric are **local unit tests** (`src/test`), not instrumented tests (`src/androidTest`). They run on the JVM through the `test<Variant>UnitTest` task. A module's `build.gradle.kts`:

```kts
plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.plugin.compose")
}

android {
    namespace = "com.example.app"
    compileSdk = 37
    defaultConfig {
        minSdk = 24
        targetSdk = 36
    }
    buildFeatures { compose = true }
    testOptions {
        unitTests.isIncludeAndroidResources = true
        unitTests.all {
            // Robolectric 4.17 on JDK 24+ (robolectric/robolectric#11434).
            it.jvmArgs("--add-opens=java.base/jdk.internal.access=ALL-UNNAMED")
        }
    }
}

dependencies {
    val composeBom = platform("androidx.compose:compose-bom:2026.09.00")
    implementation(composeBom)
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.activity:activity-compose:1.13.0")

    // Declares ComponentActivity in the debug manifest so createComposeRule() can launch it.
    debugImplementation("androidx.compose.ui:ui-test-manifest")

    testImplementation(composeBom)
    testImplementation("androidx.compose.ui:ui-test-junit4")
    testImplementation("junit:junit:4.13.2")
    testImplementation("org.robolectric:robolectric:4.17")
    testImplementation("androidx.test.ext:junit-ktx:1.3.0")
    testImplementation("org.jetbrains.kotlinx:kotlinx-coroutines-test:1.11.0")
}
```

With AGP 9 the module does not apply `org.jetbrains.kotlin.android`: AGP 9 has built-in Kotlin support and enables it by default. The Compose compiler plugin is still applied, with the same version as Kotlin. In the root build:

```kts
plugins {
    id("com.android.application") version "9.5.1" apply false
    id("org.jetbrains.kotlin.plugin.compose") version "2.4.21" apply false
}
```

Add more test dependencies when a test needs them: `androidx.test:core-ktx` (`ActivityScenario`, `ApplicationProvider`), `androidx.test.espresso:espresso-core` and `espresso-intents` ([interop-views.md](../testing-patterns/interop-views.md), [activities-intents.md](../testing-patterns/activities-intents.md)), `androidx.navigation:navigation-testing` ([navigation.md](../testing-patterns/navigation.md)), Roborazzi ([screenshot-testing.md](../testing-patterns/screenshot-testing.md)), and `ui-test-junit4-accessibility` ([accessibility.md](../testing-patterns/accessibility.md)).

## Why Each Piece Is There

| Piece | What breaks without it |
| --- | --- |
| `testImplementation(composeBom)` | The BOM applies per configuration. Without it in `testImplementation`, `ui-test-junit4` has no version and the build fails to resolve it |
| `ui-test-junit4` | Provides `createComposeRule`, finders, assertions, actions. It pulls in `ui-test` |
| `debugImplementation("…ui-test-manifest")` | `createComposeRule()` and `createAndroidComposeRule<ComponentActivity>()` launch `ComponentActivity`. This artifact declares it in the merged **debug** manifest. Without it Robolectric fails with "Unable to resolve activity for Intent" |
| `unitTests.isIncludeAndroidResources = true` | Robolectric's Getting Started guide requires it. It gives unit tests access to the module's merged Android resources, assets, and manifest |
| `--add-opens=java.base/jdk.internal.access=ALL-UNNAMED` | On JDK 24+ Robolectric 4.17 fails with `IllegalAccessException … jdk.internal.access.SharedSecrets` (robolectric/robolectric#11434) |
| `org.robolectric:robolectric` | `RobolectricTestRunner`. Compose tests detect Robolectric and use its looper-based idling |
| `kotlinx-coroutines-test` | Already on the classpath through `ui-test`; declare it when tests use `runTest`, `StandardTestDispatcher`, or `TestScope` directly |

`ui-test-manifest` is a `debugImplementation` dependency, so it reaches `testDebugUnitTest` but not `testReleaseUnitTest`. Run Compose tests on the debug variant, or add `releaseImplementation` too if you must run them on release. It is not `testImplementation` because the activity must be in the **app's** merged manifest, which unit-test dependencies do not contribute to.

A custom Activity defined only under `src/test` is **not** in any manifest, so `createAndroidComposeRule<MyTestActivity>()` fails with the same "Unable to resolve activity" error. Use `ComponentActivity` and `setContent`, or declare the activity in a debug-only manifest (`src/debug/AndroidManifest.xml`). See [activities-intents.md](../testing-patterns/activities-intents.md).

Robolectric's Getting Started page lists a longer set of `--add-opens` flags for Java 17 and higher. Start with the one above and add others only when an `InaccessibleObjectException` or `IllegalAccessException` names another package.

## Version Catalog

The same setup with `gradle/libs.versions.toml`:

```toml
[versions]
agp = "9.5.1"
kotlin = "2.4.21"

[libraries]
compose-bom = { module = "androidx.compose:compose-bom", version = "2026.09.00" }
compose-ui = { module = "androidx.compose.ui:ui" }
compose-material3 = { module = "androidx.compose.material3:material3" }
compose-ui-test-junit4 = { module = "androidx.compose.ui:ui-test-junit4" }
compose-ui-test-manifest = { module = "androidx.compose.ui:ui-test-manifest" }
activity-compose = { module = "androidx.activity:activity-compose", version = "1.13.0" }
junit = { module = "junit:junit", version = "4.13.2" }
robolectric = { module = "org.robolectric:robolectric", version = "4.17" }
androidx-test-ext-junit = { module = "androidx.test.ext:junit-ktx", version = "1.3.0" }
kotlinx-coroutines-test = { module = "org.jetbrains.kotlinx:kotlinx-coroutines-test", version = "1.11.0" }

[plugins]
android-application = { id = "com.android.application", version.ref = "agp" }
kotlin-compose = { id = "org.jetbrains.kotlin.plugin.compose", version.ref = "kotlin" }
```

```kts
dependencies {
    implementation(platform(libs.compose.bom))
    implementation(libs.compose.ui)
    implementation(libs.compose.material3)
    implementation(libs.activity.compose)
    debugImplementation(libs.compose.ui.test.manifest)

    testImplementation(platform(libs.compose.bom))
    testImplementation(libs.compose.ui.test.junit4)
    testImplementation(libs.junit)
    testImplementation(libs.robolectric)
    testImplementation(libs.androidx.test.ext.junit)
    testImplementation(libs.kotlinx.coroutines.test)
}
```

## Running the Tests

```bash
./gradlew :app:testDebugUnitTest
./gradlew :app:testDebugUnitTest --tests 'com.example.LoginScreenTest'
./gradlew :app:testDebugUnitTest --tests '*LoginScreenTest.shows_error*'
```

The first run downloads the Android framework jar (`android-all-instrumented`) for each SDK level a test uses, so it is slow once and then cached. Set the `robolectric.offline` system property to `true` with `robolectric.dependency.dir` when CI must not fetch at test time ([ci.md](../infrastructure-ci-cd/ci.md)). Filtering, `@Ignore`, and per-test `@Config` are in [annotations-filtering.md](annotations-filtering.md).

## A First Test

Annotate the class with `@RunWith(RobolectricTestRunner::class)` (or `AndroidJUnit4::class`, which delegates to Robolectric on the JVM) and use the **v2** rule:

```kotlin
import androidx.compose.foundation.layout.Column
import androidx.compose.material3.Button
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

@Composable
fun Counter() {
    var count by remember { mutableIntStateOf(0) }
    Column {
        Text("Count: $count")
        Button(onClick = { count++ }) { Text("Increment") }
    }
}

@RunWith(RobolectricTestRunner::class)
class CounterTest {
    @get:Rule
    val composeTestRule = createComposeRule()

    @Test
    fun increment_updatesCount() {
        composeTestRule.setContent { Counter() }

        composeTestRule.onNodeWithText("Increment").performClick()

        composeTestRule.onNodeWithText("Count: 1").assertIsDisplayed()
    }
}
```

The import is `androidx.compose.ui.test.junit4.v2.createComposeRule`. The v1 `androidx.compose.ui.test.junit4.createComposeRule` is deprecated and uses a different coroutine dispatcher ([synchronization.md](synchronization.md#v1-vs-v2-dispatchers), [migration.md](../architecture/migration.md)).

## @Config and robolectric.properties

`@Config` on a class or method configures Robolectric for those tests. A method-level `@Config` takes precedence over the class-level one, and base classes are searched too.

| `@Config` field | Use |
| --- | --- |
| `sdk` | One or more API levels to run on. Each level runs the test once |
| `minSdk` / `maxSdk` | A range of levels. Cannot be combined with `sdk` in the same `@Config` |
| `qualifiers` | Resource qualifiers: locale, size, density, orientation, night mode |
| `application` | The `Application` class to create instead of the manifest's |
| `shadows` | Extra shadow classes |

For every test in a package (and its subpackages), put `robolectric.properties` on the test classpath at that package's path. A file at the root of `src/test/resources` applies to the whole module:

```properties
# src/test/resources/robolectric.properties
sdk=36
qualifiers=w411dp-h891dp-xxhdpi
```

Deeper packages override shallower ones, and `@Config` overrides properties files. Prefer one root `robolectric.properties` for module-wide defaults and `@Config` for tests that need something different.

## Choosing SDK Levels

Without `sdk`, Robolectric runs each test on the module's **`targetSdk`**. Robolectric 4.17 supports API levels up to 37.

```kotlin
import android.os.Build
import androidx.compose.material3.Text
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [Config.TARGET_SDK])
class GreetingSdkTest {
    @get:Rule
    val composeTestRule = createComposeRule()

    @Test
    fun runsOnTargetSdk() {
        composeTestRule.setContent { Text("API ${Build.VERSION.SDK_INT}") }

        composeTestRule.onNodeWithText("API 36").assertIsDisplayed()
    }
}
```

| Choice | When |
| --- | --- |
| Default (`targetSdk`) | Almost every Compose test. Compose code rarely branches on API level |
| `@Config(sdk = [Config.OLDEST_SDK])` (`minSdk`) | Code with `Build.VERSION.SDK_INT` branches, or APIs that differ on old platforms |
| `@Config(sdk = [26, 36])` | A specific behavior that changed between two levels |
| `@Config(minSdk = 33)` | A feature that only exists from some level on |
| `@Config(sdk = [Config.ALL_SDKS])` | Almost never: one run per supported level between `minSdk` and the newest |

Every extra level multiplies run time and downloads another framework jar. Pin the SDK on the specific tests that branch on it, not on the whole suite:

```kotlin compile-only
import android.os.Build
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@Composable
fun NotificationsHint() {
    Text(if (Build.VERSION.SDK_INT >= 33) "Allow notifications" else "Notifications are on")
}

@RunWith(RobolectricTestRunner::class)
class NotificationsHintTest {
    @get:Rule
    val composeTestRule = createComposeRule()

    @Test
    @Config(sdk = [Build.VERSION_CODES.TIRAMISU])
    fun api33_asksForPermission() {
        composeTestRule.setContent { NotificationsHint() }
        composeTestRule.onNodeWithText("Allow notifications").assertIsDisplayed()
    }

    @Test
    @Config(sdk = [Build.VERSION_CODES.S_V2])
    fun api32_saysNotificationsAreOn() {
        composeTestRule.setContent { NotificationsHint() }
        composeTestRule.onNodeWithText("Notifications are on").assertIsDisplayed()
    }
}
```

The `robolectric.enabledSdks` system property (for example `-Drobolectric.enabledSdks=36`) limits a run to some levels. Tests configured only for other levels are skipped. Use it to keep a fast local loop and run the full matrix in CI.

## Qualifiers and the Default Device

Without qualifiers, Robolectric simulates a small device: **`w320dp-h470dp`, `mdpi`, `port`, `en-rUS`, `notnight`**. Compose lays out in that window, so content beyond 470dp is off screen and `assertIsDisplayed()` fails on it until you scroll ([lists-scrolling.md](../testing-patterns/lists-scrolling.md)).

```kotlin
import android.content.res.Configuration
import androidx.compose.foundation.layout.Column
import androidx.compose.material3.Text
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
class QualifiersTest {
    @get:Rule
    val composeTestRule = createComposeRule()

    @Test
    fun defaultDevice_is320x470dp() {
        composeTestRule.setContent {
            val config = LocalConfiguration.current
            Text("${config.screenWidthDp}x${config.screenHeightDp}")
        }

        composeTestRule.onNodeWithText("320x470").assertIsDisplayed()
    }

    @Test
    @Config(qualifiers = "w411dp-h891dp-night")
    fun qualifiers_setSizeAndNightMode() {
        composeTestRule.setContent {
            val config = LocalConfiguration.current
            val night = config.uiMode and Configuration.UI_MODE_NIGHT_MASK == Configuration.UI_MODE_NIGHT_YES
            Column {
                Text("${config.screenWidthDp}x${config.screenHeightDp}")
                Text(if (night) "Dark" else "Light")
            }
        }

        composeTestRule.onNodeWithText("411x891").assertIsDisplayed()
        composeTestRule.onNodeWithText("Dark").assertIsDisplayed()
    }
}
```

- A `qualifiers` value **replaces** qualifiers from a higher level (class, properties file). Start it with `+` to **overlay** them instead: class `@Config(qualifiers = "xlarge-port")` plus method `@Config(qualifiers = "+land")` gives `xlarge-land`.
- Locale (`fr-rFR`), layout direction (`ldrtl`), density (`xxhdpi`), orientation (`land`), and night mode (`night`) are all qualifiers. `ldrtl` alone does not make Compose lay out right to left; see [configuration-changes.md](../testing-patterns/configuration-changes.md) for what does.
- `@Config(qualifiers = …)` changes the whole simulated device. To vary one composable's configuration inside a test, `DeviceConfigurationOverride` is usually simpler. Both are covered in [configuration-changes.md](../testing-patterns/configuration-changes.md).

## Custom Application Class

Robolectric creates the `Application` named in the merged manifest before each test. If that class does heavy work in `onCreate` (DI graph, analytics, WorkManager), give tests a lighter one with `@Config(application = …)`:

```kotlin
import android.app.Application
import androidx.compose.material3.Text
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

class TestApplication : Application() {
    val greeting = "Hello from the test app"
}

@RunWith(RobolectricTestRunner::class)
@Config(application = TestApplication::class)
class TestApplicationTest {
    @get:Rule
    val composeTestRule = createComposeRule()

    @Test
    fun content_readsFromTestApplication() {
        composeTestRule.setContent {
            val app = LocalContext.current.applicationContext as TestApplication
            Text(app.greeting)
        }

        composeTestRule.onNodeWithText("Hello from the test app").assertIsDisplayed()
    }
}
```

The test application class can live in `src/test`: Robolectric instantiates it directly, so it does not need to be in the manifest (unlike activities). Hilt tests use `HiltTestApplication` this way ([rules-fixtures.md](rules-fixtures.md)).

## Looper and Graphics Modes

Two Robolectric modes matter for Compose. Both are set with an annotation on a package, class, or method, a `robolectric.properties` key, or a `robolectric.<key>` system property.

| Mode | Default in 4.17 | Values | Compose impact |
| --- | --- | --- | --- |
| `@LooperMode` (`looperMode`) | `PAUSED` | `PAUSED`, `INSTRUMENTATION_TEST`, `LEGACY` (deprecated) | The test runs on the main looper thread and posted tasks run only when the looper is idled. Compose's test rule idles it for you ([synchronization.md](synchronization.md#robolectric-paused-looper)) |
| `@GraphicsMode` (`graphicsMode`) | `LEGACY` | `LEGACY`, `NATIVE` | `LEGACY` graphics shadows are no-ops, so nothing is really drawn. Semantics-based tests do not need pixels. Screenshot tests need `NATIVE` |

Keep `PAUSED`. `LEGACY` looper mode is deprecated and not supported on SDKs after Baklava (36). Switch graphics mode only for tests that read pixels:

```kotlin snippet
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class ProfileScreenshotTest { /* captureRoboImage() … */ }
```

or for a whole module, in `src/test/resources/robolectric.properties`:

```properties
graphicsMode=NATIVE
```

`NATIVE` downloads and loads native graphics libraries and is slower. Set it on screenshot test classes, not module-wide, unless most tests are screenshot tests ([screenshot-testing.md](../testing-patterns/screenshot-testing.md), [performance.md](../infrastructure-ci-cd/performance.md)).

## Anti-Patterns

| Anti-Pattern | Problem | Solution |
| --- | --- | --- |
| Compose UI tests in `src/androidTest` when you meant Robolectric | They need a device or emulator | Put Robolectric tests in `src/test` |
| `testImplementation("androidx.compose.ui:ui-test-manifest")` | The activity is not merged into the app manifest; "Unable to resolve activity" | `debugImplementation` |
| Forgetting `testImplementation(platform(composeBom))` | `ui-test-junit4` has no version | Apply the BOM to every configuration that uses Compose artifacts |
| Importing `androidx.compose.ui.test.junit4.createComposeRule` | Deprecated v1 API with `UnconfinedTestDispatcher` | `androidx.compose.ui.test.junit4.v2.createComposeRule` |
| `@Config(sdk = [Config.ALL_SDKS])` on a whole class | One run per API level; slow and downloads many jars | Default `targetSdk`; pin extra levels only on tests that branch on them |
| `minSdk` and `sdk` in the same `@Config` | Not allowed | Use one or the other |
| Copying every `--add-opens` flag from a blog post | Hides which flag is really needed | Add the `jdk.internal.access` flag and others only when an error names them |
| `graphicsMode=NATIVE` for the whole module | Slower, and pixels do not matter to semantics tests | Annotate screenshot test classes only |
| A test-only Activity in `src/test` passed to `createAndroidComposeRule` | Not in the manifest, so it cannot start | `ComponentActivity` + `setContent`, or a `src/debug` manifest entry |

## Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| `Unable to resolve activity for Intent { … ComponentActivity }` | `ui-test-manifest` missing, not `debugImplementation`, or running a release unit-test task | Add `debugImplementation("androidx.compose.ui:ui-test-manifest")`; run `testDebugUnitTest` |
| `IllegalAccessException: … cannot access class jdk.internal.access.SharedSecrets` | JDK 24+ without the `--add-opens` flag | Add it to `unitTests.all { it.jvmArgs(…) }` |
| Tests are slow only on the first run | Robolectric downloads `android-all-instrumented` per SDK | Cache `~/.m2` in CI, or use offline mode ([ci.md](../infrastructure-ci-cd/ci.md)) |
| A node exists but `assertIsDisplayed()` fails | It is below the default 470dp window | Scroll to it, or set a larger `qualifiers` size |
| Deprecation warnings for `createComposeRule` | The v1 import | Switch to the `v2` package ([migration.md](../architecture/migration.md)) |

More error messages are in [common-errors.md](../debugging/common-errors.md).

## Related References

- **Rule types and test layout**: [test-structure.md](test-structure.md)
- **Per-test `@Config`, `@Ignore`, filtering**: [annotations-filtering.md](annotations-filtering.md)
- **Dark mode, locale, RTL, font scale**: [configuration-changes.md](../testing-patterns/configuration-changes.md)
- **Screenshot tests and `NATIVE` graphics**: [screenshot-testing.md](../testing-patterns/screenshot-testing.md)
- **CI caching and offline mode**: [ci.md](../infrastructure-ci-cd/ci.md)
- **Robolectric vs instrumented tests**: [test-architecture.md](../architecture/test-architecture.md)
