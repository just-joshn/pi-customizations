# Test Architecture

## Table of Contents

1. [The Four Kinds of Compose-Related Tests](#the-four-kinds-of-compose-related-tests)
2. [Decision Guide](#decision-guide)
3. [Plain JVM Unit Tests](#plain-jvm-unit-tests)
4. [Robolectric Compose Tests](#robolectric-compose-tests)
5. [What Robolectric Does and Does Not Simulate](#what-robolectric-does-and-does-not-simulate)
6. [Instrumented Compose Tests](#instrumented-compose-tests)
7. [Screenshot Tests](#screenshot-tests)
8. [One Test Source for JVM and Device](#one-test-source-for-jvm-and-device)
9. [A Recommended Split](#a-recommended-split)
10. [Anti-Patterns](#anti-patterns)
11. [Related References](#related-references)

## The Four Kinds of Compose-Related Tests

| Kind | Source set / task | Runs on | Speed | Fidelity | Good for |
| --- | --- | --- | --- | --- | --- |
| Plain JVM unit test | `src/test`, `testDebugUnitTest` | JVM, no Android | Fastest | Logic only | ViewModels, reducers, validators, mappers |
| Robolectric Compose test | `src/test`, `testDebugUnitTest` | JVM with a simulated Android | Fast | Semantics and behavior; approximate layout and pixels | Component and screen behavior |
| Instrumented Compose test | `src/androidTest`, `connectedDebugAndroidTest` | Emulator or device | Slow | Real rendering, IME, system UI | Device-only behavior, critical journeys |
| Screenshot test | `src/test` with Roborazzi (this skill), or a device | JVM (`NATIVE` graphics) or device | Medium | Pixels, within the renderer's fidelity | Visual regressions in themes, sizes, states |

Android's testing strategy guide maps these onto layers: unit tests on the host; component and feature tests on Robolectric or an emulator; application and release-candidate tests on emulators and devices. Its rule of thumb is to use the lowest layer that gives the right feedback.

## Decision Guide

```
Does the code under test need Android or Compose at all?
├─ No (pure Kotlin: validation, formatting, state reducers, ViewModel logic)
│  └─ Plain JVM unit test.
│
└─ Yes, it's UI
   ├─ Asserting what the user sees or can do (text, enabled, click → state)
   │  └─ Robolectric Compose test.
   ├─ Asserting how it looks (colors, spacing, theming, sizes)
   │  └─ Screenshot test (testing-patterns/screenshot-testing.md).
   └─ Depends on the real device:
      soft keyboard behavior, WebView, edge-to-edge/system bars,
      picture-in-picture, real GPU rendering, hardware, performance
      └─ Instrumented test.
```

## Plain JVM Unit Tests

If logic can live outside a composable, test it without Compose. These tests have no runner, no Robolectric sandbox, and start in milliseconds:

```kotlin
import com.google.common.truth.Truth.assertThat
import org.junit.Test

data class PasswordCheck(val tooShort: Boolean, val missingDigit: Boolean) {
    val isValid get() = !tooShort && !missingDigit
}

fun checkPassword(password: String) =
    PasswordCheck(tooShort = password.length < 8, missingDigit = password.none(Char::isDigit))

class PasswordRulesTest {
    @Test
    fun shortPassword_isInvalid() {
        assertThat(checkPassword("abc1").tooShort).isTrue()
    }

    @Test
    fun longPasswordWithDigit_isValid() {
        assertThat(checkPassword("correcthorse1").isValid).isTrue()
    }
}
```

Moving rules like this out of composables is the main way to keep the Robolectric layer thin. ViewModels without Compose are tested this way too, with `runTest` and `Dispatchers.setMain` ([viewmodel-state.md](../testing-patterns/viewmodel-state.md#viewmodel-tests-without-compose)).

## Robolectric Compose Tests

Robolectric runs Compose UI tests in the `test` source set with the same `ui-test` APIs as on a device. Android's Robolectric guide recommends it for isolated UI behavior tests of components, features, and applications, and for screenshots where pixel accuracy is not critical. Compose's own guidance is to test composables in isolation, while still having some tests that cover larger parts of the UI.

```kotlin
import androidx.compose.foundation.layout.Column
import androidx.compose.material3.Button
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
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
fun Expandable(summary: String, details: String) {
    var expanded by remember { mutableStateOf(false) }
    Column {
        Text(summary)
        if (expanded) Text(details)
        Button(onClick = { expanded = !expanded }) { Text(if (expanded) "Less" else "More") }
    }
}

@RunWith(RobolectricTestRunner::class)
class ExpandableTest {
    @get:Rule val composeTestRule = createComposeRule()

    @Test
    fun more_revealsDetails() {
        composeTestRule.setContent { Expandable("Shipping", "Arrives Tuesday") }

        composeTestRule.onNodeWithText("More").performClick()

        composeTestRule.onNodeWithText("Arrives Tuesday").assertIsDisplayed()
        composeTestRule.onNodeWithText("Less").assertIsDisplayed()
    }
}
```

These tests should be most of your UI tests. Setup is in [setup-configuration.md](../core/setup-configuration.md); structure in [test-structure.md](../core/test-structure.md).

## What Robolectric Does and Does Not Simulate

| Area | Under Robolectric 4.17 | Consequence |
| --- | --- | --- |
| Composition, recomposition, state, effects | Real Compose runtime | Behavior tests are trustworthy |
| Semantics tree, finders, assertions, input injection | Real `ui-test` | Same test code as on a device |
| Main thread | `PAUSED` looper: posted work runs when the looper is idled | Compose test APIs idle it; see [synchronization.md](../core/synchronization.md#robolectric-paused-looper) |
| Delayed work on `Dispatchers.Main` | The looper's clock is separate from the Compose test clock | `delay` in `viewModelScope` needs a shared scheduler ([rules-fixtures.md](../core/rules-fixtures.md#custom-testrule-maindispatcherrule)) |
| Drawing | `GraphicsMode.LEGACY` by default: graphics shadows are no-ops | No real pixels unless `@GraphicsMode(NATIVE)` |
| Text measurement | Not realistic in `LEGACY` (with the pinned stack `Text("Hello world")` was 11×35 px vs 69×16 px in `NATIVE`) | Don't assert text sizes or wrapping without `NATIVE` |
| Resources, qualifiers, locale, night mode | Real resource loading with `isIncludeAndroidResources`; qualifiers via `@Config` | Configuration tests work ([configuration-changes.md](../testing-patterns/configuration-changes.md)) |
| Activities, intents, permissions | Shadows of the framework | Most flows work; see [activities-intents.md](../testing-patterns/activities-intents.md) |
| Soft keyboard (IME) | No real keyboard; `performTextInput` sends text through the semantics action | IME visibility and `imePadding` need a device ([forms-text-input.md](../testing-patterns/forms-text-input.md#the-software-keyboard-under-robolectric)) |
| System UI (status bar, edge-to-edge, picture-in-picture) | Not a real system UI | Device test |
| WebView | Not supported | Device test |
| Hardware (camera, sensors, GPU) | Shadows with test hooks, no real hardware | Device test for anything hardware-dependent |
| Performance | JVM timing, not device timing | Use Macrobenchmark on a device |

Android's Robolectric guide sums it up: Robolectric has enough fidelity for most UI tests, but system UI (edge-to-edge, picture-in-picture) and unsupported features (WebView) still need device tests.

## Instrumented Compose Tests

Instrumented tests use the same `createComposeRule` and finders, in `src/androidTest`, with `androidx.test.runner.AndroidJUnitRunner`. Keep them for:

- Critical user journeys on a release-like build.
- Anything in the "Device test" rows above.
- Checking that a Robolectric-only result holds on real hardware, for a few representative screens.

They are slower and need an emulator, so run them post-merge or nightly, per Android's testing strategy guidance. This skill's examples run only on Robolectric.

## Screenshot Tests

Screenshot tests catch visual regressions that semantics assertions can't. With Roborazzi they run in `src/test` under Robolectric with `@GraphicsMode(NATIVE)`. Robolectric's renderer is not a real GPU, so treat screenshots as "did this change?" checks, not proof of on-device appearance. Details: [screenshot-testing.md](../testing-patterns/screenshot-testing.md).

## One Test Source for JVM and Device

`@RunWith(AndroidJUnit4::class)` from `androidx.test.ext:junit` runs a class under Robolectric on the JVM and under the instrumentation runner on a device. With the pinned stack, a Compose test annotated with `AndroidJUnit4` passed under Robolectric unchanged. To run the same file both ways, add a shared directory to both source sets:

```kts
android {
    sourceSets["test"].kotlin.directories.add("src/sharedTest/kotlin")
    sourceSets["androidTest"].kotlin.directories.add("src/sharedTest/kotlin")
}
```

Shared tests must avoid Robolectric-only APIs (`shadowOf`, `@Config`, `@GraphicsMode`, `RuntimeEnvironment`) and must not depend on the JVM's timing. We verified the `test` side of this setup (the harness adds a directory to `test` this way); the `androidTest` side needs an emulator and is not verified here. Only share the tests whose device run adds information; duplicating every test doubles CI time.

## A Recommended Split

| Layer | Share of UI-related tests | What goes there |
| --- | --- | --- |
| Plain JVM | As much logic as you can move out of composables | Validation, formatting, reducers, ViewModels |
| Robolectric Compose | Most UI tests | Every screen's states, interactions, navigation, configuration variants |
| Screenshot (Roborazzi) | Design-system components and key screens | Themes, font scales, sizes, dark mode |
| Instrumented | A small set | Critical journeys, IME, WebView, system UI, device-specific bugs |

Run plain JVM and Robolectric tests on every commit; screenshot verification on every PR; instrumented tests post-merge or nightly ([ci.md](../infrastructure-ci-cd/ci.md)).

## Anti-Patterns

| Anti-pattern | Problem | Do instead |
| --- | --- | --- |
| Testing validation rules through the UI | Slow, indirect | Plain JVM test of the rule, plus one UI test of the wiring |
| Moving every UI test to the device "for fidelity" | Slow, flaky, rarely run | Robolectric for behavior; device for device-only behavior |
| Asserting pixel sizes or text wrapping under `LEGACY` graphics | Fake measurements | `NATIVE` graphics or a device |
| Testing IME or WebView behavior under Robolectric | Not simulated | Instrumented test |
| Only screenshot tests for a screen | Pixels don't prove clicks work | Behavior tests plus a few screenshots |
| `shadowOf` calls inside shared JVM/device tests | Fails on device | Keep Robolectric APIs in `src/test` only |

## Related References

- [setup-configuration.md](../core/setup-configuration.md): Robolectric setup and modes
- [when-to-mock.md](when-to-mock.md): what to fake at each layer
- [screenshot-testing.md](../testing-patterns/screenshot-testing.md): Roborazzi
- [performance.md](../infrastructure-ci-cd/performance.md), [ci.md](../infrastructure-ci-cd/ci.md): running the layers
