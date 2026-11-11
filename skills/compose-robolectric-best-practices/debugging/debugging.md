# Debugging Compose Tests

## Table of Contents

1. [Read the Failure First](#read-the-failure-first)
2. [Print the Semantics Tree](#print-the-semantics-tree)
3. [Merged vs Unmerged Trees](#merged-vs-unmerged-trees)
4. [Dialogs and Other Windows](#dialogs-and-other-windows)
5. [Robolectric Logging](#robolectric-logging)
6. [Looking at Pixels](#looking-at-pixels)
7. [Running One Test from Gradle](#running-one-test-from-gradle)
8. [The IDE Debugger](#the-ide-debugger)
9. [Debugging Checklist](#debugging-checklist)
10. [Related References](#related-references)

## Read the Failure First

Compose test failures say what was searched for and, for assertions, what the node held. Three shapes cover most failures (quoted from the pinned stack):

**No node matched.** The selector is printed in parentheses. Check spelling, substring vs exact match, whether the node is in the merged tree, and whether it is still off screen or not yet composed.

```text
java.lang.AssertionError: Failed: assertExists.
Reason: Expected exactly '1' node but could not find any node that satisfies: (Text + InputText + EditableText contains 'Nope' (ignoreCase: false))
```

An action on a missing node reports the action instead (`Failed to inject touch input.` for `performClick`), with the same `Reason:` line.

**Several nodes matched.** The message lists them; narrow the finder ([finders-semantics.md](../core/finders-semantics.md#multiple-nodes)).

```text
java.lang.AssertionError: Failed: assertExists.
Reason: Expected exactly '1' node but found '2' nodes that satisfy: (Text + InputText + EditableText contains 'Save' (ignoreCase: false))
Nodes found:
1) Node #8 at (l=0.0, t=0.0, r=320.0, b=52.0)px
```

**The node did not satisfy an assertion.** The node's full semantics follow, then the selector:

```text
java.lang.AssertionError: Failed to assert the following: (Text + EditableText = [Stop])
Semantics of the node:
Node #7 at (l=0.0, t=70.0, r=58.0, b=122.0)px
Role = 'Button'
Text = '[Go]'
Actions = [ClearTextSubstitution, GetTextLayoutResult, OnClick, RequestFocus, SetTextSubstitution, ShowTextSubstitution]
MergeDescendants = 'true'
Has 2 siblings
Selector used: (Text + InputText + EditableText contains 'Go' (ignoreCase: false))
```

Wait failures are `ComposeTimeoutException`, for example `Condition (exactly 1 nodes match (Text + InputText + EditableText contains 'Nope' (ignoreCase: false))) still not satisfied after 100 ms`. More messages and their causes are in [common-errors.md](common-errors.md).

## Print the Semantics Tree

Finders read the semantics tree, so print it when a finder surprises you. `printToString()` returns the tree; `printToLog(tag)` sends it to Logcat, which under Robolectric goes to `ShadowLog` ([below](#robolectric-logging)).

```kotlin
import androidx.compose.foundation.layout.Column
import androidx.compose.material3.Button
import androidx.compose.material3.Text
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.test.printToLog
import androidx.compose.ui.test.printToString
import com.google.common.truth.Truth.assertThat
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.shadows.ShadowLog

@RunWith(RobolectricTestRunner::class)
class PrintTreeTest {
    @get:Rule val composeTestRule = createComposeRule()

    @Test
    fun printsTheTree() {
        composeTestRule.setContent {
            Column {
                Text("Cart")
                Button(onClick = {}) { Text("Checkout") }
            }
        }

        // To stdout: visible in the Gradle -i output and the test report.
        println(composeTestRule.onRoot().printToString())

        // To Logcat, mirrored to stdout by ShadowLog.
        ShadowLog.stream = System.out
        composeTestRule.onRoot().printToLog("TREE")

        assertThat(ShadowLog.getLogsForTag("TREE").single().msg).contains("Text = '[Checkout]'")
    }
}
```

Output, abridged:

```text
Printing with useUnmergedTree = 'false'
Node #1 at (l=0.0, t=0.0, r=…, b=…)px
 |-Node #2 at (…)px
 | Text = '[Cart]'
 |-Node #3 at (…)px
   Role = 'Button'
   Text = '[Checkout]'
   Actions = [ClearTextSubstitution, GetTextLayoutResult, OnClick, RequestFocus, SetTextSubstitution, ShowTextSubstitution]
   MergeDescendants = 'true'
```

Print any node, not just the root: `onNodeWithTag("cart").printToString()`, or `printToString(maxDepth = 1)` for a large screen. Remove printing before committing ([SKILL.md](../SKILL.md#test-validation-loop)).

Bounds are in pixels at Robolectric's default `mdpi` (1 px = 1 dp), on a 320 × 470 dp window. Text sizes are not realistic in the default `LEGACY` graphics mode: "Cart" can measure a few pixels wide. Do not debug layout overlaps from these numbers; use `NATIVE` graphics ([below](#looking-at-pixels)).

## Merged vs Unmerged Trees

Finders search the merged tree by default: a `Button` merges its icon and label into one clickable node. Print both trees when a node "exists but cannot be found":

```text
Printing with useUnmergedTree = 'false'
 |-Node #2 at (l=0.0, t=0.0, r=81.0, b=52.0)px
   ContentDescription = '[Add]'
   Role = 'Button'
   Text = '[Add item]'
   MergeDescendants = 'true'

Printing with useUnmergedTree = 'true'
 |-Node #2 at (l=0.0, t=0.0, r=81.0, b=52.0)px
   Role = 'Button'
   MergeDescendants = 'true'
    |-Node #4 at (l=24.0, t=14.0, r=48.0, b=38.0)px
    | ContentDescription = '[Add]'
    | Role = 'Image'
    |-Node #5 at (l=48.0, t=8.0, r=57.0, b=44.0)px
      Text = '[Add item]'
```

`composeTestRule.onRoot(useUnmergedTree = true).printToString()` prints the second form. If the node you want only appears in it (for example, to assert on the icon alone), pass `useUnmergedTree = true` to the finder too ([finders-semantics.md](../core/finders-semantics.md#merged-vs-unmerged-tree)).

## Dialogs and Other Windows

Dialogs, popups, and bottom sheets are separate windows with their own roots. With one open, `onRoot()` fails:

```text
java.lang.AssertionError: Failed: assertExists.
Reason: Expected exactly '1' node but found '2' nodes that satisfy: (isRoot)
```

Print every root with its children instead:

```kotlin
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.isRoot
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.printToString
import com.google.common.truth.Truth.assertThat
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

@RunWith(RobolectricTestRunner::class)
class PrintDialogTreeTest {
    @get:Rule val composeTestRule = createComposeRule()

    @Test
    fun printsEveryWindow() {
        composeTestRule.setContent {
            AlertDialog(
                onDismissRequest = {},
                confirmButton = { TextButton(onClick = {}) { Text("Delete") } },
                text = { Text("Delete this draft?") },
            )
        }

        val roots = composeTestRule.onAllNodes(isRoot())
        roots.assertCountEquals(2)
        val tree = roots.printToString(maxDepth = Int.MAX_VALUE)

        assertThat(tree).contains("Delete this draft?")
    }
}
```

Without `maxDepth`, a collection prints only the matched nodes ("Has 1 child"). Window handling is covered in [dialogs-popups.md](../testing-patterns/dialogs-popups.md#windows-and-roots).

## Robolectric Logging

Robolectric routes `android.util.Log` to `ShadowLog`, which keeps the entries in memory and prints nothing by default. To see app logs, `printToLog` output, and Robolectric's own messages:

| Option | Scope |
| --- | --- |
| `ShadowLog.stream = System.out` in a test or `@Before` | From that point in the JVM |
| `-Drobolectric.logging=stdout` (or `stderr`, or a file path) | Every test in the run |
| `ShadowLog.getLogs()` / `getLogsForTag(tag)` | Assert on logged entries |

```kts
// app/build.gradle.kts
android {
    testOptions {
        unitTests.all {
            it.systemProperty("robolectric.logging", "stdout")
            it.testLogging {
                events("failed")
                showStandardStreams = true
                exceptionFormat = org.gradle.api.tasks.testing.logging.TestExceptionFormat.FULL
            }
        }
    }
}
```

`ShadowLog.stream` is a static field: once set, it stayed set for later test classes in the same JVM with the pinned stack. That is harmless for debugging, but do not leave it in committed tests if the noise matters.

Lines look like `D/TREE: printToLog:` followed by the tree, interleaved with lifecycle lines such as `D/LifecycleMonitor: Lifecycle status change: androidx.activity.ComponentActivity@… in: RESUMED`.

## Looking at Pixels

`captureToImage()` returns an `ImageBitmap` of a node. Under the default `LEGACY` graphics mode it does not throw, but nothing is drawn: with the pinned stack every pixel was transparent. Use `@GraphicsMode(NATIVE)` to look at real pixels:

```kotlin
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.toPixelMap
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.test.captureToImage
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.unit.dp
import com.google.common.truth.Truth.assertThat
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.GraphicsMode

@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class CapturePixelsTest {
    @get:Rule val composeTestRule = createComposeRule()

    @Test
    fun swatchIsRed() {
        composeTestRule.setContent { Box(Modifier.testTag("swatch").size(10.dp).background(Color.Red)) }

        val pixels = composeTestRule.onNodeWithTag("swatch").captureToImage().toPixelMap()

        assertThat(pixels[2, 2]).isEqualTo(Color.Red)
    }
}
```

To see a whole screen while debugging, add `composeTestRule.onRoot().captureRoboImage("build/debug/screen.png")` and run the test with Roborazzi recording on (`./gradlew :app:recordRoborazziDebug --tests '…'`); without a record or verify mode Roborazzi writes nothing. Setup and modes are in [screenshot-testing.md](../testing-patterns/screenshot-testing.md).

## Running One Test from Gradle

```bash
# One class, or one method (quote the pattern)
./gradlew :app:testDebugUnitTest --tests 'com.example.cart.CartScreenTest'
./gradlew :app:testDebugUnitTest --tests 'com.example.cart.CartScreenTest.checkoutIsDisabledWhenEmpty'

# Show test stdout (println, printToString, ShadowLog.stream) in the console
./gradlew :app:testDebugUnitTest --tests '*CartScreenTest' -i

# Run even when Gradle thinks the task is up to date
./gradlew :app:testDebugUnitTest --tests '*CartScreenTest' --rerun
```

After a run, `app/build/reports/tests/testDebugUnitTest/index.html` shows each test's stack trace and standard output; the XML files in `app/build/test-results/testDebugUnitTest/` hold the same for CI ([ci.md](../infrastructure-ci-cd/ci.md)). Filtering patterns are in [annotations-filtering.md](../core/annotations-filtering.md).

## The IDE Debugger

Robolectric tests are JVM tests, so Android Studio debugs them like any unit test: set a breakpoint and choose **Debug** on the test's gutter icon. No device is involved.

- While paused, evaluate `composeTestRule.onRoot().printToString()` in the debugger to see the tree at that line.
- The test clock is virtual: sitting at a breakpoint does not advance animations or `delay`s, so stepping does not change what the test sees.
- A breakpoint in a `LaunchedEffect` after a `delay` is reached only when the test advances the clock past it.

## Debugging Checklist

1. Read the `Reason:` line and the selector. Is the text exact, a substring, or in a content description?
2. Print the tree at the failing line; print the unmerged tree if the node should be inside a clickable parent.
3. If the node is missing, check whether it is composed yet (async work, `delay`, animation) → [synchronization.md](../core/synchronization.md), [animations-clock.md](../testing-patterns/animations-clock.md).
4. If it exists but is not displayed, check its bounds against the 320 × 470 dp window → [lists-scrolling.md](../testing-patterns/lists-scrolling.md).
5. If a dialog is open, use `onAllNodes(isRoot())` and dialog-aware finders.
6. If it fails only in the suite, see [flaky-tests.md](flaky-tests.md).
7. Remove `println`, `printToLog`, and `ShadowLog.stream` lines.

## Related References

- **Error messages and setup failures**: [common-errors.md](common-errors.md)
- **Flaky and order-dependent tests**: [flaky-tests.md](flaky-tests.md)
- **Finders, merged tree, multiple nodes**: [finders-semantics.md](../core/finders-semantics.md)
- **Assertions and their messages**: [assertions.md](../core/assertions.md)
- **Screenshots**: [screenshot-testing.md](../testing-patterns/screenshot-testing.md)
