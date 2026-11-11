# Screenshot Testing with Roborazzi

## Table of Contents

1. [When to Use Screenshots](#when-to-use-screenshots)
2. [Setup](#setup)
3. [Record, Verify, Compare](#record-verify-compare)
4. [Capturing a Node or a Composable](#capturing-a-node-or-a-composable)
5. [Stable Device Size, Theme, and Locale](#stable-device-size-theme-and-locale)
6. [RoborazziRule and Options](#roborazzirule-and-options)
7. [Dialogs and the Whole Screen](#dialogs-and-the-whole-screen)
8. [Avoiding Flaky Pixels](#avoiding-flaky-pixels)
9. [Reviewing Diffs](#reviewing-diffs)
10. [Anti-Patterns](#anti-patterns)
11. [Troubleshooting](#troubleshooting)

## When to Use Screenshots

Roborazzi renders Compose under Robolectric Native Graphics and saves PNGs from JVM tests. Use screenshots for what semantics cannot express: layout, spacing, color, typography, clipping, dark theme. Keep behavior assertions in ordinary Compose tests; a screenshot that changes for any reason tells the reviewer *that* something moved, not *what* broke.

| Concern | Test with |
| --- | --- |
| Text, state, enabled, navigation | Semantics assertions ([assertions.md](../core/assertions.md)) |
| Layout, theming, truncation, RTL mirroring | Roborazzi screenshot |
| Both: a component library's look across states | One screenshot per state, plus semantics tests for behavior |

## Setup

Apply the Gradle plugin and add the libraries. The plugin creates the record, verify, and compare tasks and passes their mode to the tests.

```kts
// settings or root build.gradle.kts
plugins {
    id("io.github.takahirom.roborazzi") version "1.78.0" apply false
}
```

```kts
// module build.gradle.kts
plugins {
    id("io.github.takahirom.roborazzi")
}

android {
    testOptions {
        unitTests.isIncludeAndroidResources = true
    }
}

dependencies {
    testImplementation("io.github.takahirom.roborazzi:roborazzi:1.78.0")
    testImplementation("io.github.takahirom.roborazzi:roborazzi-compose:1.78.0")
    testImplementation("io.github.takahirom.roborazzi:roborazzi-junit-rule:1.78.0")
}
```

Every screenshot test class needs `@GraphicsMode(GraphicsMode.Mode.NATIVE)`; without native graphics nothing real is drawn. The Roborazzi README also recommends `robolectric.pixelCopyRenderMode=hardware` for more accurate images:

```kts
android {
    testOptions {
        unitTests.all {
            it.systemProperties["robolectric.pixelCopyRenderMode"] = "hardware"
        }
    }
}
```

The README notes that native graphics may render incorrectly on old SDK levels and suggests API 28 or higher; pin the SDK with `@Config(sdk = [...])` or `robolectric.properties` (see [setup-configuration.md](../core/setup-configuration.md)).

## Record, Verify, Compare

| Task | Same as `testDebugUnitTest` with | What it does |
| --- | --- | --- |
| `recordRoborazziDebug` | `-Proborazzi.test.record=true` | Writes reference images |
| `verifyRoborazziDebug` | `-Proborazzi.test.verify=true` | Fails the test if an image differs from its reference |
| `compareRoborazziDebug` | `-Proborazzi.test.compare=true` | Writes `<name>_compare.png` and a JSON diff; does not fail |
| `verifyAndRecordRoborazziDebug` | both `verify` and `record` | Verifies, then records a new reference on difference |
| `clearRoborazziDebug` | (not a test task) | Deletes saved images; experimental |

```bash
./gradlew :app:recordRoborazziDebug          # create or update references
./gradlew :app:verifyRoborazziDebug          # CI gate
./gradlew :app:compareRoborazziDebug         # local review of a change
```

**Plain `testDebugUnitTest` runs screenshot tests without capturing.** With no `roborazzi.test.*` property set (the README: "By default, all settings are set to false"), `captureRoboImage` does nothing: with the pinned stack the test passed and no file was written, for both node and lambda captures. That keeps screenshot tests cheap in the normal unit test run but means they guard nothing there. Run `verifyRoborazziDebug` in CI. In verify mode with no reference image, the test failed and Roborazzi wrote `_actual` and `_compare` images, so record references before turning on the gate.

Outputs:

| Path | Contents |
| --- | --- |
| `build/outputs/roborazzi/` | Reference images (default), plus `_actual` / `_compare` images |
| `build/reports/roborazzi/index.html` | HTML report |
| `build/test-results/roborazzi/` | JSON diff results |

References under `build/` are lost on `clean`. To commit them, point the plugin at a source directory:

```kts
roborazzi {
    outputDir.set(file("src/test/screenshots"))
}
```

## Capturing a Node or a Composable

`captureRoboImage()` on a `SemanticsNodeInteraction` captures that node. Without a path the file name comes from the test (`com.example.CardTest.default.png` under the default `testPackageAndClassAndMethod` naming strategy). The composable-lambda form renders content without a compose rule.

```kotlin
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Card
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.unit.dp
import com.github.takahirom.roborazzi.captureRoboImage
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.GraphicsMode

@Composable
fun ProfileCard(name: String, role: String) {
    Card(Modifier.testTag("profile").padding(16.dp)) {
        Column(Modifier.padding(16.dp)) {
            Text(name, style = MaterialTheme.typography.titleMedium)
            Text(role, style = MaterialTheme.typography.bodyMedium)
        }
    }
}

@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class ProfileCardScreenshotTest {
    @get:Rule val composeTestRule = createComposeRule()

    @Test
    fun default() {
        composeTestRule.setContent { MaterialTheme { ProfileCard("Ada Lovelace", "Engineer") } }

        composeTestRule.onNodeWithTag("profile").captureRoboImage()
    }

    @Test
    fun longNameWraps() {
        captureRoboImage("src/test/screenshots/ProfileCard_longName.png") {
            MaterialTheme { ProfileCard("Augusta Ada King, Countess of Lovelace", "Engineer") }
        }
    }
}
```

An explicit path is relative to the module directory by default (`roborazzi.record.filePathStrategy=relativePathFromCurrentDirectory`). Set the strategy to `relativePathFromRoborazziContextOutputDirectory` in `gradle.properties` to resolve names against the plugin's `outputDir` instead. Prefer one naming scheme per module; mixing generated and hand-written paths makes stale images hard to find.

## Stable Device Size, Theme, and Locale

Robolectric's default device is small and its density is 1.0, which rarely matches what designers review. Pin the device with `RobolectricDeviceQualifiers` and add qualifiers for night mode or locale, per class or per test.

```kotlin
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onRoot
import com.github.takahirom.roborazzi.RobolectricDeviceQualifiers
import com.github.takahirom.roborazzi.captureRoboImage
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(qualifiers = RobolectricDeviceQualifiers.Pixel5)
class CheckoutButtonScreenshotTest {
    @get:Rule val composeTestRule = createComposeRule()

    private fun setThemedContent() {
        composeTestRule.setContent {
            MaterialTheme(colorScheme = if (isSystemInDarkTheme()) darkColorScheme() else lightColorScheme()) {
                Button(onClick = {}) { Text("Checkout") }
            }
        }
    }

    @Test
    fun light() {
        setThemedContent()
        composeTestRule.onRoot().captureRoboImage()
    }

    @Test
    @Config(qualifiers = "+night")
    fun dark() {
        setThemedContent()
        composeTestRule.onRoot().captureRoboImage()
    }
}
```

`+night` and `+ja` append to the class-level device qualifiers. Locale, RTL, and font scale are covered in [configuration-changes.md](configuration-changes.md).

## RoborazziRule and Options

`RoborazziRule` is optional. It supplies context to `captureRoboImage()` in the test (output directory, file naming, `RoborazziOptions`) and can capture automatically per test with `captureType` (`LastImage`, `AllImage`, `Gif`, optionally only on failure).

```kotlin
import androidx.compose.material3.Text
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onRoot
import com.dropbox.differ.SimpleImageComparator
import com.github.takahirom.roborazzi.RoborazziOptions
import com.github.takahirom.roborazzi.RoborazziRule
import com.github.takahirom.roborazzi.captureRoboImage
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.GraphicsMode

@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class BadgeScreenshotTest {
    @get:Rule(order = 0) val composeTestRule = createComposeRule()

    @get:Rule(order = 1)
    val roborazziRule = RoborazziRule(
        options = RoborazziRule.Options(
            roborazziOptions = RoborazziOptions(
                compareOptions = RoborazziOptions.CompareOptions(
                    changeThreshold = 0.01f,
                    imageComparator = SimpleImageComparator(maxDistance = 0.007f, vShift = 2, hShift = 2),
                ),
            ),
        ),
    )

    @Test
    fun badge() {
        composeTestRule.setContent { Text("3 new") }

        composeTestRule.onRoot().captureRoboImage()
    }
}
```

`changeThreshold = 0.01f` accepts up to 1% changed pixels; `SimpleImageComparator` shifts tolerate anti-aliasing differences. Loosen thresholds only after you have seen a diff that is pure noise: a threshold high enough to hide anti-aliasing can also hide a 1 px border that disappeared.

## Dialogs and the Whole Screen

A node capture covers the node's own window. Dialogs and popups live in other windows (see [dialogs-popups.md](dialogs-popups.md)). The README lists `captureScreenRoboImage()` as an experimental API that captures the entire screen, including dialogs.

```kotlin
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.ui.test.isDialog
import androidx.compose.ui.test.junit4.v2.createComposeRule
import com.github.takahirom.roborazzi.ExperimentalRoborazziApi
import com.github.takahirom.roborazzi.captureScreenRoboImage
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.GraphicsMode

@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class ConfirmDialogScreenshotTest {
    @get:Rule val composeTestRule = createComposeRule()

    @OptIn(ExperimentalRoborazziApi::class)
    @Test
    fun dialogOverScreen() {
        composeTestRule.setContent {
            Text("Inbox")
            AlertDialog(
                onDismissRequest = {},
                title = { Text("Discard draft?") },
                confirmButton = { TextButton(onClick = {}) { Text("Discard") } },
            )
        }
        composeTestRule.onNode(isDialog()).assertExists()

        captureScreenRoboImage()
    }
}
```

Assert the dialog exists before capturing, so a screenshot of an empty screen can't be recorded as the reference by accident.

## Avoiding Flaky Pixels

| Source | Fix |
| --- | --- |
| Animations mid-flight | Let finders settle them, or pause the clock (`mainClock.autoAdvance = false`) and advance to a fixed frame ([animations-clock.md](animations-clock.md)) |
| Infinite animations (spinners, shimmer) | Pause the clock before `setContent`; capture at a fixed time |
| Current time and dates | Pass a fixed clock or formatted strings into the composable ([test-data.md](../core/test-data.md)) |
| Random data, generated avatars | Seeded or fixed test data |
| Network images | A fake image loader or a placeholder in tests |
| Different OS rendering | Record and verify on the same OS image (CI); the Roborazzi FAQ notes macOS, Linux, and Windows can render differently |
| Device size and density defaults | `RobolectricDeviceQualifiers` on the class |
| Cursor blink in a focused text field | Pause the clock, or don't focus fields in screenshots |

```kotlin
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onRoot
import com.github.takahirom.roborazzi.captureRoboImage
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.GraphicsMode

@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class SpinnerScreenshotTest {
    @get:Rule val composeTestRule = createComposeRule()

    @Test
    fun spinnerAtAFixedFrame() {
        composeTestRule.mainClock.autoAdvance = false
        composeTestRule.setContent { CircularProgressIndicator() }
        composeTestRule.mainClock.advanceTimeBy(500)

        composeTestRule.onRoot().captureRoboImage()
    }
}
```

With `autoAdvance` on, an infinite animation keeps the composition busy; with it off, every run draws the same frame.

## Reviewing Diffs

1. Run `compareRoborazziDebug` locally (or download the CI artifacts) and open `build/reports/roborazzi/index.html`.
2. For each `_compare.png`, decide: intended change, regression, or noise.
3. Re-record only after every diff is explained: `recordRoborazziDebug`, then commit the new references with the code change that caused them.
4. Delete references for removed tests. Roborazzi does not clean up old screenshots unless `roborazzi.cleanupOldScreenshots=true`, because it can't tell a filtered run from a removed test.

For CI workflows that store references and comment diffs on pull requests, see the Roborazzi README's GitHub Actions guide and [ci.md](../infrastructure-ci-cd/ci.md).

## Anti-Patterns

| Anti-Pattern | Problem | Solution |
| --- | --- | --- |
| Expecting `testDebugUnitTest` to catch visual regressions | Capture is a no-op without a mode property | `verifyRoborazziDebug` in CI |
| Missing `@GraphicsMode(NATIVE)` | Nothing real is rendered | Annotate every screenshot class |
| Screenshot instead of a semantics assertion for text or state | Noisy diffs; intent invisible | Semantics test for behavior; screenshot for looks |
| Re-recording to make CI green | Accepts regressions as the new reference | Review every `_compare.png` first |
| Default device size and density | References don't match any real device | `RobolectricDeviceQualifiers` |
| References only under `build/` | Lost on `clean`, not in review | `roborazzi { outputDir.set(file(...)) }` and commit them |
| Capturing during an animation | Different frame each run | Pause or settle the clock |
| Recording on macOS, verifying on Linux CI | Platform rendering differences | Record and verify on the same platform |

## Troubleshooting

### No images are written

Check that a record, verify, or compare task (or property) is in use; plain `testDebugUnitTest` writes nothing. The Roborazzi FAQ also suggests `ROBORAZZI_DEBUG = true` for logs and checking that the plugin is applied.

### Verify fails right after adding a test

There is no reference yet. Run `recordRoborazziDebug` and commit the image.

### Images look broken or blank

Confirm `@GraphicsMode(GraphicsMode.Mode.NATIVE)`, and an SDK of 28 or higher.

### Out of memory in large suites

Screenshot tests hold bitmaps; see the Roborazzi FAQ and [performance.md](../infrastructure-ci-cd/performance.md) for forking and heap settings.

## Related References

- **Animations and the paused clock**: [animations-clock.md](animations-clock.md)
- **Dark mode, locale, RTL, font scale**: [configuration-changes.md](configuration-changes.md)
- **Robolectric graphics mode and SDK config**: [setup-configuration.md](../core/setup-configuration.md)
- **Windows for dialogs and popups**: [dialogs-popups.md](dialogs-popups.md)
- **Running in CI**: [ci.md](../infrastructure-ci-cd/ci.md)
