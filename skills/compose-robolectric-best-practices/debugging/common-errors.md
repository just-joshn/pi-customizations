# Common Errors

Every message below was reproduced with the pinned stack (Compose BOM 2026.09.00, Robolectric 4.17, AGP 9.5, JDK 25). Values in angle brackets (`<…>`) vary.

## Table of Contents

1. [Quick Lookup](#quick-lookup)
2. [No compose hierarchies found in the app](#no-compose-hierarchies-found-in-the-app)
3. [Expected exactly '1' node](#expected-exactly-1-node)
4. [Unable to resolve activity for Intent](#unable-to-resolve-activity-for-intent)
5. [Resources$NotFoundException](#resourcesnotfoundexception)
6. [Failed to interact with raw FileDescriptor internals](#failed-to-interact-with-raw-filedescriptor-internals)
7. [Deprecated createComposeRule (v1)](#deprecated-createcomposerule-v1)
8. [Opt-in Required for Experimental Test APIs](#opt-in-required-for-experimental-test-apis)
9. [ComposeTimeoutException](#composetimeoutexception)
10. [AppNotIdleException: The Test Never Goes Idle](#appnotidleexception-the-test-never-goes-idle)
11. [Failed to parse qualifier string](#failed-to-parse-qualifier-string)
12. [Espresso Cannot See Compose (and Vice Versa)](#espresso-cannot-see-compose-and-vice-versa)
13. [AAR Metadata and Manifest Merger Failures](#aar-metadata-and-manifest-merger-failures)
14. [Related References](#related-references)

## Quick Lookup

| Message (start) | Usual cause | Section |
| --- | --- | --- |
| `No compose hierarchies found in the app` | No `setContent`, activity not resumed, or recreated without content | [link](#no-compose-hierarchies-found-in-the-app) |
| `Expected exactly '1' node but could not find any node` | Finder does not match (text, merged tree, not composed yet) | [link](#expected-exactly-1-node) |
| `Expected exactly '1' node but found '2' nodes` | Ambiguous finder, or `onRoot()` with a dialog open | [link](#expected-exactly-1-node) |
| `Unable to resolve activity for Intent` | Activity not in the merged manifest | [link](#unable-to-resolve-activity-for-intent) |
| `Resources$NotFoundException: String resource ID #0x…` | `isIncludeAndroidResources` off, or a wrong ID | [link](#resourcesnotfoundexception) |
| `Failed to interact with raw FileDescriptor internals; perhaps JRE has changed?` | JDK 24+ without `--add-opens` | [link](#failed-to-interact-with-raw-filedescriptor-internals) |
| `'fun createComposeRule(…)' is deprecated` | v1 import with warnings as errors | [link](#deprecated-createcomposerule-v1) |
| `This testing API is experimental` | Missing `@OptIn(ExperimentalTestApi::class)` | [link](#opt-in-required-for-experimental-test-apis) |
| `ComposeTimeoutException: … still not satisfied after N ms` | `waitUntil` condition never true | [link](#composetimeoutexception) |
| `AppNotIdleException: Compose did not get idle after N attempts in 60 SECONDS` | Compose or an idling resource never becomes idle | [link](#appnotidleexception-the-test-never-goes-idle) |
| `Failed to parse qualifier string` | Qualifiers out of order | [link](#failed-to-parse-qualifier-string) |
| `NoMatchingViewException` for Compose text | Espresso used on a composable | [link](#espresso-cannot-see-compose-and-vice-versa) |
| `issues were found when checking AAR metadata` / `Manifest merger failed : uses-sdk:minSdkVersion` | `compileSdk` or `minSdk` below what the BOM's libraries need | [link](#aar-metadata-and-manifest-merger-failures) |

## No compose hierarchies found in the app

```text
java.lang.IllegalStateException: No compose hierarchies found in the app. Possible reasons include: (1) the Activity that calls setContent did not launch; (2) setContent was not called; (3) setContent was called before the ComposeTestRule ran. If setContent is called by the Activity, make sure the Activity is launched after the ComposeTestRule runs
```

Causes we hit:

| Cause | Fix |
| --- | --- |
| A finder ran before `composeTestRule.setContent { … }` | Call `setContent` first, once per test |
| `createAndroidComposeRule<YourActivity>()` and the activity does not call `setContent` (or crashed before it) | Make the activity set its content; check the log for the crash |
| `scenario.moveToState(Lifecycle.State.CREATED)` and then a finder | Move back to `RESUMED` before using finders ([activities-intents.md](../testing-patterns/activities-intents.md#lifecycle-states)) |
| `scenario.recreate()` after the test set content on a `ComponentActivity` | The recreated activity is empty; use `StateRestorationTester` for composables ([configuration-changes.md](../testing-patterns/configuration-changes.md#activity-recreation)) |

## Expected exactly '1' node

Not found:

```text
java.lang.AssertionError: Failed: assertExists.
Reason: Expected exactly '1' node but could not find any node that satisfies: (Text + InputText + EditableText contains 'Nope' (ignoreCase: false))
```

An action prints the action name first, for example `Failed to inject touch input.` for `performClick`. Check, in order: the exact text and `substring`/`ignoreCase`; whether the text lives in a `contentDescription` instead; whether the node only appears in the unmerged tree; whether it is composed yet (async work, `delay`, animation). Print the tree ([debugging.md](debugging.md#print-the-semantics-tree)).

Several matches:

```text
java.lang.AssertionError: Failed: assertExists.
Reason: Expected exactly '1' node but found '2' nodes that satisfy: (Text + InputText + EditableText contains 'Save' (ignoreCase: false))
```

Narrow the finder with `hasAnyAncestor`, `hasClickAction`, a parent tag, or `onAllNodes…[index]` when the order is meaningful ([finders-semantics.md](../core/finders-semantics.md#multiple-nodes)). Assertions that accept at most one node word it differently: `Failed to perform checkIsDisplayed check: Expected at most 1 node but found 2 nodes that satisfy (…)`.

With a dialog, popup, or sheet open there are two roots, and `onRoot()` fails:

```text
java.lang.AssertionError: Failed: assertExists.
Reason: Expected exactly '1' node but found '2' nodes that satisfy: (isRoot)
```

Use `onAllNodes(isRoot())` to print, and `isDialog()`-scoped finders to act ([dialogs-popups.md](../testing-patterns/dialogs-popups.md#windows-and-roots)).

## Unable to resolve activity for Intent

```text
java.lang.RuntimeException: Unable to resolve activity for Intent { act=android.intent.action.MAIN cat=[android.intent.category.LAUNCHER] cmp=skill.harness/<package>.TestOnlyActivity } -- see https://github.com/robolectric/robolectric/pull/4736 for details
```

Robolectric only launches activities in the merged manifest. Two ways to get here:

**An activity defined in `src/test`.** It compiles but is never in the manifest:

```kotlin compile-only
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.material3.Text
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithText
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

// BAD: lives in src/test, so no manifest declares it.
class TestOnlyActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent { Text("Hello") }
    }
}

@RunWith(RobolectricTestRunner::class)
class TestOnlyActivityTest {
    @get:Rule val composeTestRule = createAndroidComposeRule<TestOnlyActivity>()

    @Test
    fun showsHello() {
        composeTestRule.onNodeWithText("Hello").assertExists()
    }
}
```

Fix: use `createAndroidComposeRule<ComponentActivity>()` with `setContent`, test the real activity from `src/main`, or declare the test activity in a `src/debug/AndroidManifest.xml`.

**`unitTests.isIncludeAndroidResources` is off.** Then Robolectric does not use the merged manifest at all, and even `ui-test-manifest`'s activity is missing. Note the package `org.robolectric.default`:

```text
java.lang.RuntimeException: Unable to resolve activity for Intent { act=android.intent.action.MAIN cat=[android.intent.category.LAUNCHER] cmp=org.robolectric.default/androidx.activity.ComponentActivity } -- see https://github.com/robolectric/robolectric/pull/4736 for details
```

```kts
android {
    testOptions {
        unitTests.isIncludeAndroidResources = true
    }
}
```

The same message with your app's package and `androidx.activity.ComponentActivity` means `ui-test-manifest` is missing or not `debugImplementation` ([setup-configuration.md](../core/setup-configuration.md#troubleshooting)).

## Resources$NotFoundException

```text
android.content.res.Resources$NotFoundException: String resource ID #0x7f08000f
```

Seen when reading an app string (`context.getString(R.string.greeting)`) with `unitTests.isIncludeAndroidResources = false`: the `R` class exists, but Robolectric has no resources to look it up in. Set it to `true` as above. With resources included, the same exception with an ID that does not exist (`String resource ID #0x7f990001`) means a wrong or stale ID, such as one from another module's `R` that is not on the test classpath.

## Failed to interact with raw FileDescriptor internals

```text
java.lang.RuntimeException: Failed to interact with raw FileDescriptor internals; perhaps JRE has changed?
	at org.robolectric.interceptors.AndroidInterceptors$FileDescriptorInterceptor.setInt(AndroidInterceptors.java:88)
	...
Caused by: java.lang.IllegalAccessException: class org.robolectric.interceptors.AndroidInterceptors$FileDescriptorInterceptor cannot access class jdk.internal.access.SharedSecrets (in module java.base) because module java.base does not export jdk.internal.access to unnamed module @<hash>
```

Every Robolectric test fails like this on JDK 24 and newer (robolectric/robolectric#11434). Open the package to the test JVM:

```kts
android {
    testOptions {
        unitTests.all {
            it.jvmArgs("--add-opens=java.base/jdk.internal.access=ALL-UNNAMED")
        }
    }
}
```

Running the tests on JDK 23 or older also avoids it ([setup-configuration.md](../core/setup-configuration.md)).

## Deprecated createComposeRule (v1)

With `allWarningsAsErrors = true`, the v1 import fails compilation:

```text
e: warnings found and -Werror specified
e: file://<path>.kt:<line>:<column> 'fun createComposeRule(effectContext: CoroutineContext = ...): ComposeContentTestRule' is deprecated. Use `androidx.compose.ui.test.junit4.v2.createComposeRule` instead. The v2 APIs use StandardTestDispatcher instead of UnconfinedTestDispatcher, which aligns with standard coroutine behavior by queuing tasks rather than executing them immediately. Tests relying on immediate execution may require explicit synchronization. Please refer to the migration guide for more details.
```

Change the import:

```kotlin snippet
// Before
import androidx.compose.ui.test.junit4.createComposeRule
// After
import androidx.compose.ui.test.junit4.v2.createComposeRule
```

The same applies to `createAndroidComposeRule`, `createEmptyComposeRule`, and `runComposeUiTest` (`androidx.compose.ui.test.v2`). Tests that relied on coroutines running immediately may now need a synchronizing call; see [migration.md](../architecture/migration.md).

## Opt-in Required for Experimental Test APIs

```text
e: file://<path>.kt:<line>:<column> This testing API is experimental and is likely to be changed or removed entirely
```

Seen calling `waitUntilExactlyOneExists` without opting in. Add `@OptIn(ExperimentalTestApi::class)` (`androidx.compose.ui.test.ExperimentalTestApi`) to the test function or class.

## ComposeTimeoutException

```text
androidx.compose.ui.test.ComposeTimeoutException: Condition still not satisfied after 100 ms
androidx.compose.ui.test.ComposeTimeoutException: Condition (exactly 1 nodes match (Text + InputText + EditableText contains 'Nope' (ignoreCase: false))) still not satisfied after 100 ms
```

A `waitUntil` (first) or `waitUntilExactlyOneExists` (second) condition stayed false. The time is virtual: `waitUntil` advances the Compose clock while polling, so a `delay` in a `LaunchedEffect` is reached quickly. Causes:

- The condition depends on work the test clock does not drive: `delay` in `viewModelScope` (see [viewmodel-state.md](../testing-patterns/viewmodel-state.md#dispatchersmain-under-robolectric)), `Handler.postDelayed` ([synchronization.md](../core/synchronization.md#robolectric-paused-looper)).
- The condition is wrong: print the tree at the timeout.
- Real-thread work slower than the timeout ([flaky-tests.md](flaky-tests.md#work-on-real-threads)).

Do not raise the timeout until you know which.

## AppNotIdleException: The Test Never Goes Idle

```text
androidx.test.espresso.AppNotIdleException: Compose did not get idle after 24748 attempts in 60 SECONDS.

1. Check your measure/layout lambdas for infinite composition loops.
```

When Compose or an idling resource never becomes idle, the first synchronizing call (a finder, an assertion, `waitForIdle()`, or `setContent` itself) keeps retrying for 60 seconds and then fails with this message:

| Cause | Observed |
| --- | --- |
| A `LaunchedEffect` looping on `withFrameNanos` forever, then any finder | `AppNotIdleException` after about 60 s |
| A registered `IdlingResource` that is busy when `setContent` runs, or never reports idle | `AppNotIdleException` after about 60 s |

Infinite animations from `rememberInfiniteTransition` and indeterminate progress indicators do not cause this: the test rule pauses them. Fix the frame loop as in [animations-clock.md](../testing-patterns/animations-clock.md#infinite-animations); make idling resources report idle once their work ends and unregister them in `@After` ([synchronization.md](../core/synchronization.md#idling-resources)). A test that takes just over a minute and then fails is a strong hint.

## Failed to parse qualifier string

```text
java.lang.IllegalArgumentException: Failed to parse qualifier string 'night-fr-rFR-w400dp-h800dp-land-ldrtl'. Found unrecognized trailing qualifier segments fr, rfr, w400dp, h800dp, land, ldrtl, . See https://developer.android.com/guide/topics/resources/providing-resources.html#QualifierRules for expected format.
```

Qualifiers must follow Android's resource-qualifier order. The same set in order, `fr-rFR-ldrtl-w400dp-h800dp-land-night`, parsed. See [configuration-changes.md](../testing-patterns/configuration-changes.md) for what each qualifier changes (and that `ldrtl` alone did not make Compose RTL).

## Espresso Cannot See Compose (and Vice Versa)

```text
androidx.test.espresso.NoMatchingViewException: No views in hierarchy found matching: an instance of android.widget.TextView and view.getText() with or without transformation to match: is "Tap"
```

`onView(withText("Tap"))` searched Views for text that a composable shows. Use `composeTestRule.onNodeWithText`. The reverse, `onNodeWithText` for a `TextView` inside `AndroidView`, fails with "could not find any node". See [interop-views.md](../testing-patterns/interop-views.md).

## AAR Metadata and Manifest Merger Failures

The Compose BOM's libraries declare the minimum `compileSdk` they need. Below it, the build fails before tests run:

```text
Execution failed for task ':<module>:checkDebugAarMetadata' (registered by plugin 'com.android.internal.application').
> A failure occurred while executing com.android.build.gradle.internal.tasks.CheckAarMetadataWorkAction
   > 21 issues were found when checking AAR metadata:

       1.  Dependency '<group>:<artifact>:<version>' requires libraries and applications that
           depend on it to compile against version 37 or later of the
           Android APIs.

           :<module> is currently compiled against android-35.
```

With the pinned stack the first of the 21 issues named `navigation-compose-android` 2.10.2; Compose 1.12.1 artifacts such as `animation-core-android` also require 37. Raise `compileSdk` (37 for this stack). That does not change `targetSdk` or `minSdk`.

A `minSdk` below a library's minimum fails manifest merging:

```text
Execution failed for task ':<module>:processDebugMainManifest' (registered by plugin 'com.android.internal.application').
> Manifest merger failed : uses-sdk:minSdkVersion 21 cannot be smaller than version 24 declared in library [androidx.navigation:navigation-runtime-android:2.10.2] <path>/AndroidManifest.xml as the library might be using APIs not available in 21
```

Raise `minSdk` to at least the library's value (24 for Navigation 2.10). The suggested `tools:overrideLibrary` can crash at runtime on older devices.

## Related References

- **Reading failures and printing the tree**: [debugging.md](debugging.md)
- **Flaky and order-dependent failures**: [flaky-tests.md](flaky-tests.md)
- **Gradle and Robolectric setup**: [setup-configuration.md](../core/setup-configuration.md)
- **v1 to v2 migration**: [migration.md](../architecture/migration.md)
- **Dialogs, windows, and back**: [dialogs-popups.md](../testing-patterns/dialogs-popups.md)
