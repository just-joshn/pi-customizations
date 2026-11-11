# Migration

## Table of Contents

1. [v1 to v2 Compose Test APIs](#v1-to-v2-compose-test-apis)
2. [What Changes in v2: StandardTestDispatcher](#what-changes-in-v2-standardtestdispatcher)
3. [Fixing Tests That Fail After the Switch](#fixing-tests-that-fail-after-the-switch)
4. [runTest Plus a Rule → runComposeUiTest](#runtest-plus-a-rule--runcomposeuitest)
5. [Docs Newer Than 1.12: ComposeUiTestConfig](#docs-newer-than-112-composeuitestconfig)
6. [Upgrading Robolectric to 4.17](#upgrading-robolectric-to-417)
7. [From Espresso View Tests to Compose Tests](#from-espresso-view-tests-to-compose-tests)
8. [Migration Checklist](#migration-checklist)
9. [Related References](#related-references)

## v1 to v2 Compose Test APIs

Compose `ui-test` 1.11 added `v2` versions of the APIs that create the test environment and deprecated the v1 versions. Only the entry points moved; finders, assertions, actions, and `mainClock` are unchanged. For most files the migration is an import change:

| Deprecated (v1) | Replacement (v2) |
| --- | --- |
| `androidx.compose.ui.test.junit4.createComposeRule` | `androidx.compose.ui.test.junit4.v2.createComposeRule` |
| `androidx.compose.ui.test.junit4.createAndroidComposeRule` | `androidx.compose.ui.test.junit4.v2.createAndroidComposeRule` |
| `androidx.compose.ui.test.junit4.createEmptyComposeRule` | `androidx.compose.ui.test.junit4.v2.createEmptyComposeRule` |
| `androidx.compose.ui.test.junit4.AndroidComposeTestRule` (constructor) | `androidx.compose.ui.test.junit4.v2.AndroidComposeTestRule` (factory function) |
| `androidx.compose.ui.test.runComposeUiTest` | `androidx.compose.ui.test.v2.runComposeUiTest` |
| `androidx.compose.ui.test.runAndroidComposeUiTest` | `androidx.compose.ui.test.v2.runAndroidComposeUiTest` |
| `androidx.compose.ui.test.runEmptyComposeUiTest` | `androidx.compose.ui.test.v2.runEmptyComposeUiTest` |
| `androidx.compose.ui.test.AndroidComposeUiTestEnvironment` | `androidx.compose.ui.test.v2.AndroidComposeUiTestEnvironment` |

The old form, which a warnings-as-errors build rejects:

```kotlin snippet
import androidx.compose.ui.test.junit4.createComposeRule   // deprecated v1

@get:Rule val composeTestRule = createComposeRule()
```

The new form changes only the import:

```kotlin snippet
import androidx.compose.ui.test.junit4.v2.createComposeRule

@get:Rule val composeTestRule = createComposeRule()
```

A project-wide find-and-replace of the imports is the usual first step: `junit4.createComposeRule` → `junit4.v2.createComposeRule`, and so on for each row. The return types (`ComposeContentTestRule`, `AndroidComposeTestRule<…>`) keep their packages, so field types and helper signatures don't change. In 1.12.1, `v2.runComposeUiTest` and the `waitUntil*Exists` helpers are `@ExperimentalTestApi`, so keep or add the `@OptIn`.

## What Changes in v2: StandardTestDispatcher

| | v1 | v2 |
| --- | --- | --- |
| Dispatcher for composition and effects | `UnconfinedTestDispatcher`: a launched coroutine runs immediately, up to its first suspension | `StandardTestDispatcher`: a launched coroutine is queued until the test idles or advances the clock |
| Effect | Hides ordering bugs that happen in production | Matches production ordering and `runTest` |
| Finders and assertions | Sync to idle | Same: they sync to idle, which runs queued work |

The exception to "v1 keeps its old behavior": constructing or subclassing `AndroidComposeUiTestEnvironment` directly switched to `StandardTestDispatcher` even in v1.

This test shows the queueing. It launches a coroutine directly in the composition's scope, which is what a test does when it calls into a state holder that uses that scope. Until something idles, the coroutine has not run:

```kotlin
import androidx.compose.material3.Text
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.test.junit4.v2.createComposeRule
import com.google.common.truth.Truth.assertThat
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.launch
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

@RunWith(RobolectricTestRunner::class)
class QueuedCoroutineTest {
    @get:Rule val composeTestRule = createComposeRule()

    @Test
    fun launchedWork_runsWhenTheTestIdles() {
        lateinit var scope: CoroutineScope
        composeTestRule.setContent {
            scope = rememberCoroutineScope()
            Text("Editor")
        }
        val saved = mutableListOf<String>()

        scope.launch { saved += "draft" }
        assertThat(saved).isEmpty()          // v2: queued, not run yet

        composeTestRule.waitForIdle()
        assertThat(saved).containsExactly("draft")
    }
}
```

Work started by UI actions is less visible: with the pinned stack, a coroutine launched from a button's `onClick` had already run when `performClick()` returned.

## Fixing Tests That Fail After the Switch

Most tests keep passing, because finders and assertions already synchronize. Failures follow a few patterns:

| Symptom after migrating | Cause | Fix |
| --- | --- | --- |
| Assertion on a plain variable or a ViewModel field sees the old value | The coroutine is queued; nothing idled before the check | `waitForIdle()` before the check, or put it in `runOnIdle { }` |
| A `LaunchedEffect` with `delay(…)` never finishes; text stays "Loading" | Under v2, `waitForIdle()` does not advance through a `delay` (verified in [synchronization.md](../core/synchronization.md#v1-vs-v2-dispatchers)) | `mainClock.advanceTimeBy(ms)` |
| Need an intermediate state without moving time | Idling would skip it | `mainClock.scheduler.runCurrent()` runs tasks due now without advancing |
| Test used `runTest { advanceTimeBy(…) }` with a rule | Two schedulers; advancing one doesn't move Compose | `runComposeUiTest` (next section), or pass `mainClock.scheduler` to `runTest` |
| ViewModel `delay` in `viewModelScope` never finishes | Robolectric's main looper clock is not the Compose clock; unrelated to v2 | Share the scheduler with `Dispatchers.setMain` ([rules-fixtures.md](../core/rules-fixtures.md#custom-testrule-maindispatcherrule)) |

A `delay` in a `LaunchedEffect`, fixed with the test clock:

```kotlin
import androidx.compose.material3.Text
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import kotlinx.coroutines.delay
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

@RunWith(RobolectricTestRunner::class)
class DelayedStatusTest {
    @get:Rule val composeTestRule = createComposeRule()

    @Test
    fun status_changesAfterOneSecond() {
        composeTestRule.setContent {
            var status by remember { mutableStateOf("Loading") }
            LaunchedEffect(Unit) {
                delay(1_000)
                status = "Done"
            }
            Text(status)
        }
        composeTestRule.onNodeWithText("Loading").assertIsDisplayed()

        composeTestRule.mainClock.advanceTimeBy(1_000)

        composeTestRule.onNodeWithText("Done").assertIsDisplayed()
    }
}
```

Don't fix v2 failures by adding `Thread.sleep` or by staying on the deprecated v1 imports. If many tests need the same fix, it usually points at a missing shared scheduler or a test that asserts on non-UI state too early.

## runTest Plus a Rule → runComposeUiTest

With a rule, `runTest { }` creates a second scheduler. `advanceTimeBy` inside it does not move the Compose clock:

```kotlin snippet
@Test fun twoClocks() {
    composeTestRule.setContent { DelayedStatus() }
    runTest {
        advanceTimeBy(1_000)   // moves runTest's clock only
        composeTestRule.onNodeWithText("Done").assertIsDisplayed()   // fails
    }
}
```

`runComposeUiTest` runs the block inside its own `runTest` on the Compose scheduler, so suspend calls and the test clock line up:

```kotlin
import androidx.compose.material3.Text
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.test.ExperimentalTestApi
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.v2.runComposeUiTest
import kotlinx.coroutines.delay
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

@OptIn(ExperimentalTestApi::class)
@RunWith(RobolectricTestRunner::class)
class DelayedStatusRunTest {
    @Test
    fun status_changesAfterOneSecond() = runComposeUiTest {
        setContent {
            var status by remember { mutableStateOf("Loading") }
            LaunchedEffect(Unit) {
                delay(1_000)
                status = "Done"
            }
            Text(status)
        }

        mainClock.advanceTimeBy(1_000)

        onNodeWithText("Done").assertIsDisplayed()
    }
}
```

When a class must keep its rule (other rules depend on it), pass `composeTestRule.mainClock.scheduler` to `runTest` instead so both share one scheduler.

## Docs Newer Than 1.12: ComposeUiTestConfig

The current migration page on developer.android.com also describes `ComposeUiTestConfig` (`effectContext`, `runTestContext`, `testTimeout`, `inputMode` in one object) and failure-capture policies. Those ship in **1.13.0-alpha01** and later and do not exist in `ui-test` 1.12.1. On 1.12.1 the v2 factories take the settings as parameters:

| Setting | 1.12.1 v2 API |
| --- | --- |
| Extra coroutine context for effects | `createComposeRule(effectContext = …)`, `runComposeUiTest(effectContext = …)` |
| `runTest` context and timeout | `runComposeUiTest(effectContext, runTestContext, testTimeout) { }` |

When you upgrade to 1.13, those parameter overloads are deprecated in favor of `ComposeUiTestConfig`. The 1.13 v2 setup also forces `InputMode.Touch` at the start of every test; tests that relied on keyboard input mode set before the test then need `ComposeUiTestConfig(inputMode = InputMode.Keyboard)`.

## Upgrading Robolectric to 4.17

Notable changes between 4.10 and 4.17, from Robolectric's release notes:

| Version | Change that can affect Compose test suites |
| --- | --- |
| 4.11 | Adds SDK 34; removes SDKs 18 and below. Running on SDK 34 needs JDK 17 |
| 4.12 | Native runtime on Windows; new preinstrumented jar version (`i6`): update any cached or mirrored jars |
| 4.13 | Hardware rendering down to API 28 and better Compose graphics-layer compatibility; adds `TimeoutRule` |
| 4.14 | Adds SDK 35 |
| 4.15 | Removes many deprecated APIs (for example `ShadowApplication.getInstance()` → `shadowOf(RuntimeEnvironment.getApplication())`); `configurationChangeFix` defaults to true; default Choreographer frame delay set to 15 ms |
| 4.16 | Adds SDK 36 (needs JDK 21 for SDK 36 tests); removes SDKs 21 and 22; marks `LooperMode.LEGACY` unsupported on upcoming SDKs; deprecates `TextLayoutMode` |
| 4.17 | Adds SDK 37 as a default supported SDK; removes `AndroidVersions` (use `android.os.Build` constants); deprecates `SQLiteMode` and `shadows:httpclient` |

Practical steps:

1. **Bump the JDK first.** With `targetSdk` 36, tests run on SDK 36, which needs JDK 21+. On JDK 24 and later, 4.17 also needs `--add-opens=java.base/jdk.internal.access=ALL-UNNAMED` on the test JVM (robolectric/robolectric#11434); see [setup-configuration.md](../core/setup-configuration.md).
2. **Fix removed APIs** in the order the compiler reports them; the 4.15 release notes include a removed-symbol → replacement table.
3. **Drop `@LooperMode(LEGACY)`** and any legacy `Scheduler` usage; the default `PAUSED` mode is what Compose's test APIs expect.
4. **Remove `@Config(sdk = 21/22)`**: 4.16 no longer supports them.
5. **Re-record screenshots** if you use `NATIVE` graphics; rendering changed across these versions ([screenshot-testing.md](../testing-patterns/screenshot-testing.md)).

## From Espresso View Tests to Compose Tests

When a screen moves from Views to Compose, rewrite its Espresso test against semantics. Most calls map one-to-one:

| Espresso (Views) | Compose |
| --- | --- |
| `onView(withText("Sign in"))` | `onNodeWithText("Sign in")` |
| `onView(withContentDescription("Back"))` | `onNodeWithContentDescription("Back")` |
| `onView(withId(R.id.email))` | `onNodeWithTag("email")` (prefer text or role first) |
| `.perform(click())` | `.performClick()` |
| `.perform(typeText("a@b.c"))` | `.performTextInput("a@b.c")` |
| `.perform(replaceText("x"))` | `.performTextReplacement("x")` |
| `.perform(scrollTo())` | `.performScrollTo()` |
| `.check(matches(isDisplayed()))` | `.assertIsDisplayed()` |
| `.check(doesNotExist())` | `.assertDoesNotExist()` |
| `.check(matches(isEnabled()))` | `.assertIsEnabled()` |
| `onData(…)` / `RecyclerViewActions` | `performScrollToNode(hasText(…))` on the lazy list |
| `IdlingResource` | Compose idles itself; `registerIdlingResource` for outside work ([synchronization.md](../core/synchronization.md#idling-resources)) |

```kotlin snippet
// Before: Espresso against a View-based screen
onView(withId(R.id.email)).perform(typeText("ada@example.com"))
onView(withText("Sign in")).perform(click())
onView(withText("Welcome, Ada")).check(matches(isDisplayed()))
```

```kotlin
import androidx.compose.foundation.layout.Column
import androidx.compose.material3.Button
import androidx.compose.material3.Text
import androidx.compose.material3.TextField
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextInput
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

@RunWith(RobolectricTestRunner::class)
class SignInComposeTest {
    @get:Rule val composeTestRule = createComposeRule()

    @Test
    fun signIn_greetsUser() {
        composeTestRule.setContent {
            var email by remember { mutableStateOf("") }
            var signedIn by remember { mutableStateOf(false) }
            Column {
                TextField(email, { email = it }, label = { Text("Email") })
                Button(onClick = { signedIn = true }) { Text("Sign in") }
                if (signedIn) Text("Welcome, ${email.substringBefore('@').replaceFirstChar(Char::titlecase)}")
            }
        }

        composeTestRule.onNodeWithText("Email").performTextInput("ada@example.com")
        composeTestRule.onNodeWithText("Sign in").performClick()

        composeTestRule.onNodeWithText("Welcome, Ada").assertIsDisplayed()
    }
}
```

During a gradual migration, screens mix Views and Compose. Espresso and Compose test APIs work in the same test; see [interop-views.md](../testing-patterns/interop-views.md). Instrumented Espresso tests can often move to `src/test` to run under Robolectric with only a dependency change ([test-architecture.md](test-architecture.md)).

## Migration Checklist

1. Switch imports to `v2` (table above); keep `@OptIn(ExperimentalTestApi::class)` where needed.
2. Run the suite. For each failure, apply the matching fix from [the table](#fixing-tests-that-fail-after-the-switch); don't revert to v1.
3. Replace `runTest` + rule combinations with `runComposeUiTest`, or share `mainClock.scheduler`.
4. Turn on warnings-as-errors for test sources so deprecated APIs can't creep back.
5. Upgrade Robolectric and the JDK together; remove `LEGACY` looper mode and unsupported SDKs.
6. Ignore `ComposeUiTestConfig` examples until the project is on Compose 1.13.

## Related References

- [synchronization.md](../core/synchronization.md): idling, the test clock, v1 vs v2
- [test-structure.md](../core/test-structure.md): `runComposeUiTest`
- [setup-configuration.md](../core/setup-configuration.md): Robolectric and JDK setup
- [interop-views.md](../testing-patterns/interop-views.md): Espresso and Compose together
