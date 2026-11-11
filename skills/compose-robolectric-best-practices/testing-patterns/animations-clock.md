# Animations and the Test Clock

## Table of Contents

1. [How the Test Clock Works](#how-the-test-clock-works)
2. [Pausing the Clock](#pausing-the-clock)
3. [Asserting Mid-Animation](#asserting-mid-animation)
4. [Stepping Frame by Frame](#stepping-frame-by-frame)
5. [Infinite Animations](#infinite-animations)
6. [LaunchedEffect and delay](#launchedeffect-and-delay)
7. [Wall-Clock Time](#wall-clock-time)
8. [Anti-Patterns](#anti-patterns)
9. [Related References](#related-references)

## How the Test Clock Works

Compose tests do not run in real time. Recomposition, animations, and gestures are driven by a virtual `MainTestClock` (`composeTestRule.mainClock`). Every finder, action, and assertion first synchronizes: with `autoAdvance = true` (the default) the clock advances frame by frame until Compose has no pending work, so a finished animation looks instant.

| Call | `autoAdvance = true` (default) | `autoAdvance = false` |
| --- | --- | --- |
| `onNode…`, `perform…`, `assert…` | Advance until idle, then run | Run against the current frame |
| `waitForIdle()` | Advances the clock until Compose is idle | Only waits for idling resources |
| `mainClock.advanceTimeByFrame()` | One frame (16 ms) | One frame |
| `mainClock.advanceTimeBy(ms)` | Advances by `ms`, rounded up to whole frames | Same |
| `mainClock.advanceTimeUntil(timeoutMs) { cond }` | Advances until `cond` is true | Same |

The clock drives recomposition and animations, not Android's measure and draw passes. `advanceTimeUntil`'s condition should read Compose state; for anything else use `waitUntil` ([synchronization.md](../core/synchronization.md)).

"Idle" means no pending frames. A `delay` inside a `LaunchedEffect` is not a frame, so `waitForIdle()` does not skip it ([below](#launchedeffect-and-delay)).

## Pausing the Clock

Set `autoAdvance = false` before the action that starts the animation, then advance time yourself. A click that changes state still recomposes on the next frame, and the animation starts on the frame after that.

```kotlin
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.animateDpAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.size
import androidx.compose.material3.Button
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.test.assertWidthIsEqualTo
import androidx.compose.ui.test.getUnclippedBoundsInRoot
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.unit.dp
import com.google.common.truth.Truth.assertThat
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

@Composable
fun GrowingBar() {
    var expanded by remember { mutableStateOf(false) }
    val width by animateDpAsState(
        targetValue = if (expanded) 200.dp else 100.dp,
        animationSpec = tween(durationMillis = 1000, easing = LinearEasing),
        label = "width",
    )
    Column {
        Button(onClick = { expanded = true }) { Text("Expand") }
        Box(Modifier.testTag("bar").size(width = width, height = 8.dp))
    }
}

@RunWith(RobolectricTestRunner::class)
class GrowingBarTest {
    @get:Rule val composeTestRule = createComposeRule()

    private fun barWidth() = composeTestRule.onNodeWithTag("bar").getUnclippedBoundsInRoot().let { it.right - it.left }

    @Test
    fun barIsBetweenStartAndEndHalfwayThrough() {
        composeTestRule.setContent { GrowingBar() }
        composeTestRule.mainClock.autoAdvance = false

        composeTestRule.onNodeWithText("Expand").performClick()
        composeTestRule.mainClock.advanceTimeByFrame() // animation picks up its start time
        composeTestRule.mainClock.advanceTimeBy(500)

        assertThat(barWidth()).isGreaterThan(100.dp)
        assertThat(barWidth()).isLessThan(200.dp)

        composeTestRule.mainClock.advanceTimeBy(600)
        composeTestRule.onNodeWithTag("bar").assertWidthIsEqualTo(200.dp)
    }

    @Test
    fun finishedAnimationNeedsNoClockCode() {
        composeTestRule.setContent { GrowingBar() }

        composeTestRule.onNodeWithText("Expand").performClick()

        composeTestRule.onNodeWithTag("bar").assertWidthIsEqualTo(200.dp)
    }
}
```

Assert ranges mid-animation, not exact values: the start frame depends on when the state change is picked up. Most tests are the second kind: leave `autoAdvance` on and assert the end state.

If the test changes state directly (a `mutableStateOf` it owns) instead of through an action, call `composeTestRule.waitForIdle()` after the change so the snapshot is applied before you advance the clock.

## Asserting Mid-Animation

`AnimatedVisibility` keeps its content in the tree until the exit animation ends. With a paused clock you can check both halves of that contract:

```kotlin
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeOut
import androidx.compose.foundation.layout.Column
import androidx.compose.material3.Button
import androidx.compose.material3.Text
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

@RunWith(RobolectricTestRunner::class)
class BannerExitTest {
    @get:Rule val composeTestRule = createComposeRule()

    @Test
    fun bannerStaysUntilFadeOutEnds() {
        composeTestRule.setContent {
            var visible by remember { mutableStateOf(true) }
            Column {
                Button(onClick = { visible = false }) { Text("Dismiss") }
                AnimatedVisibility(visible, exit = fadeOut(tween(durationMillis = 300))) {
                    Text("Saved")
                }
            }
        }
        composeTestRule.mainClock.autoAdvance = false

        composeTestRule.onNodeWithText("Dismiss").performClick()
        composeTestRule.mainClock.advanceTimeBy(100)
        composeTestRule.onNodeWithText("Saved").assertExists()

        composeTestRule.mainClock.advanceTimeBy(400)
        composeTestRule.onNodeWithText("Saved").assertDoesNotExist()
        composeTestRule.onNodeWithText("Dismiss").assertIsDisplayed()
    }
}
```

Alpha, color, and offset are not in the semantics tree. To check how a frame looks, capture it with Roborazzi while the clock is paused ([screenshot-testing.md](screenshot-testing.md)); to check a value, assert bounds as above.

## Stepping Frame by Frame

`hasPendingWork()` reports whether Compose still has work queued, without waiting or advancing the clock. Use it to step through an animation one frame at a time:

```kotlin
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.layout.Column
import androidx.compose.material3.Button
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.Text
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.SemanticsMatcher
import com.google.common.truth.Truth.assertThat
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

@RunWith(RobolectricTestRunner::class)
class ProgressStepTest {
    @get:Rule val composeTestRule = createComposeRule()

    @Test
    fun progressNeverGoesBackwards() {
        composeTestRule.setContent {
            var done by remember { mutableStateOf(false) }
            val progress by animateFloatAsState(if (done) 1f else 0f, tween(200), label = "progress")
            Column {
                Button(onClick = { done = true }) { Text("Finish") }
                LinearProgressIndicator(progress = { progress })
            }
        }
        val bar = composeTestRule.onNode(SemanticsMatcher.keyIsDefined(SemanticsProperties.ProgressBarRangeInfo))
        fun current() = bar.fetchSemanticsNode().config[SemanticsProperties.ProgressBarRangeInfo].current
        composeTestRule.mainClock.autoAdvance = false

        composeTestRule.onNodeWithText("Finish").performClick()
        val seen = mutableListOf(current())
        while (composeTestRule.hasPendingWork()) {
            composeTestRule.mainClock.advanceTimeByFrame()
            seen += current()
        }

        assertThat(seen).isInOrder()
        assertThat(seen.last()).isEqualTo(1f)
    }
}
```

Compose 1.12 also adds `runWithoutImplicitWait { … }` to skip the synchronization each finder performs, which speeds up long frame loops. The docs require calling it on the UI thread with read-only assertions inside; reach for it only when such a loop is measurably slow.

## Infinite Animations

Under the Compose test rule, `rememberInfiniteTransition` and the indeterminate Material progress indicators do not block idling: the rule installs an `InfiniteAnimationPolicy`, and with the pinned stack an infinite transition stayed at its initial value however far the clock advanced. Tests of screens with spinners just work:

```kotlin
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.layout.Column
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Text
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

@RunWith(RobolectricTestRunner::class)
class LoadingScreenTest {
    @get:Rule val composeTestRule = createComposeRule()

    @Test
    fun spinnerAndPulsingLabelDoNotHangTheTest() {
        composeTestRule.setContent {
            val pulse = rememberInfiniteTransition(label = "pulse")
            val alpha by pulse.animateFloat(0.3f, 1f, infiniteRepeatable(tween(800, easing = LinearEasing)), label = "alpha")
            Column {
                CircularProgressIndicator(Modifier.semantics { contentDescription = "Loading" })
                Text("Fetching orders", Modifier.alpha(alpha))
            }
        }

        composeTestRule.onNodeWithContentDescription("Loading").assertIsDisplayed()
        composeTestRule.onNodeWithText("Fetching orders").assertIsDisplayed()
    }
}
```

A hand-written frame loop is not covered by that policy. A `LaunchedEffect` that calls `withFrameNanos` forever always has a pending frame, so the clock never reaches idle. Under Robolectric the first synchronizing call retries for 60 seconds and then fails with `AppNotIdleException: Compose did not get idle after N attempts in 60 SECONDS`.

```kotlin compile-only
import androidx.compose.material3.Text
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.withFrameNanos
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

@RunWith(RobolectricTestRunner::class)
class FrameLoopTest {
    @get:Rule val composeTestRule = createComposeRule()

    @Test
    fun neverIdles() {
        composeTestRule.setContent {
            var frames by remember { mutableStateOf(0) }
            // BAD: a pending frame forever; the test never becomes idle.
            LaunchedEffect(Unit) { while (true) { withFrameNanos { }; frames++ } }
            Text("Frames: $frames")
        }
        composeTestRule.onNodeWithText("Frames", substring = true).assertExists()
    }
}
```

Fixes, best first: build the loop on `rememberInfiniteTransition` or `withInfiniteAnimationFrameNanos` (both respect the policy); make the animation a parameter so tests pass a static value; or set `mainClock.autoAdvance = false` and advance a fixed number of frames.

## LaunchedEffect and delay

A `delay` in a `LaunchedEffect` runs on the test clock, but it is not a pending frame. Observed with the v2 rule:

| Call | Does it run a 3 s `delay`? |
| --- | --- |
| A finder or `waitForIdle()` | No; the clock stays where it was |
| `mainClock.advanceTimeBy(3_000)` | Yes |
| `waitUntil { … }` | Yes; it advances the clock while polling |
| `mainClock.advanceTimeUntil(5_000) { … }` | Yes |

```kotlin
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
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

@Composable
fun UndoSnackbar(onTimeout: () -> Unit) {
    var visible by remember { mutableStateOf(true) }
    LaunchedEffect(Unit) {
        delay(4_000)
        visible = false
        onTimeout()
    }
    if (visible) Text("Message deleted. Undo?")
}

@RunWith(RobolectricTestRunner::class)
class UndoSnackbarTest {
    @get:Rule val composeTestRule = createComposeRule()

    @Test
    fun hidesAfterFourSeconds() {
        var timedOut = false
        composeTestRule.setContent { UndoSnackbar(onTimeout = { timedOut = true }) }

        composeTestRule.mainClock.advanceTimeBy(3_900)
        composeTestRule.onNodeWithText("Message deleted. Undo?").assertIsDisplayed()

        composeTestRule.mainClock.advanceTimeBy(100)
        composeTestRule.onNodeWithText("Message deleted. Undo?").assertDoesNotExist()
        composeTestRule.runOnIdle { check(timedOut) }
    }
}
```

`advanceTimeBy` rounds up to a whole number of 16 ms frames unless you pass `ignoreFrameDuration = true`, so `advanceTimeBy(3_999)` lands on 4000 ms and the snackbar is already gone. Leave a frame or more of margin around a boundary, as above. Use `waitUntil` when the test only cares that the state is eventually reached.

`delay` in a ViewModel's `viewModelScope` is a different clock: it runs on `Dispatchers.Main`, which `mainClock` does not advance. See [viewmodel-state.md](viewmodel-state.md#dispatchersmain-under-robolectric).

## Wall-Clock Time

`mainClock` does not change `System.currentTimeMillis()`, `Instant.now()`, or `Calendar`. Code that reads the wall clock ("Good morning", "Expires today", relative timestamps) gives different results by time of day. Inject a time source and pass a fixed one in tests:

```kotlin
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import java.util.Calendar
import java.util.TimeZone
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

fun interface WallClock {
    fun now(): Calendar
}

val SystemWallClock = WallClock { Calendar.getInstance() }

@Composable
fun Greeting(clock: WallClock = SystemWallClock) {
    val hour = clock.now().get(Calendar.HOUR_OF_DAY)
    Text(if (hour < 12) "Good morning" else "Good afternoon")
}

private fun fixedAt(hour: Int) = WallClock {
    Calendar.getInstance(TimeZone.getTimeZone("UTC")).apply {
        clear()
        set(2026, Calendar.JANUARY, 15, hour, 0)
    }
}

@RunWith(RobolectricTestRunner::class)
class GreetingTest {
    @get:Rule val composeTestRule = createComposeRule()

    @Test
    fun morning() {
        composeTestRule.setContent { Greeting(clock = fixedAt(hour = 9)) }
        composeTestRule.onNodeWithText("Good morning").assertIsDisplayed()
    }

    @Test
    fun afternoon() {
        composeTestRule.setContent { Greeting(clock = fixedAt(hour = 15)) }
        composeTestRule.onNodeWithText("Good afternoon").assertIsDisplayed()
    }
}
```

In an app with dependency injection, provide the time source from the graph (or a `CompositionLocal`) and replace it in tests ([test-data.md](../core/test-data.md), [when-to-mock.md](../architecture/when-to-mock.md)). Fix the time zone in the fake too, so CI machines in other zones agree.

## Anti-Patterns

| Anti-Pattern | Problem | Solution |
| --- | --- | --- |
| `Thread.sleep(500)` to "let the animation run" | The test clock does not move with real time | `mainClock.advanceTimeBy(500)` |
| Asserting an exact value mid-animation | Depends on which frame picked up the change | Assert a range, or the end state |
| `autoAdvance = false` in every test | Each test must step time by hand | Leave it on; pause only to inspect intermediate frames |
| Expecting `waitForIdle()` to skip a `delay` | Delays are not pending frames | `advanceTimeBy` or `waitUntil` |
| A `while (true) { withFrameNanos { } }` loop in UI code | Never idle; `AppNotIdleException` after 60 s | `rememberInfiniteTransition`, `withInfiniteAnimationFrameNanos`, or a parameter |
| Reading `System.currentTimeMillis()` in a composable | Result changes with the time of day | Inject a time source |
| Checking alpha or color through semantics | Not exposed | Screenshot at a paused frame |

## Related References

- **Synchronization, waitUntil, idling resources**: [synchronization.md](../core/synchronization.md)
- **ViewModel delays and `Dispatchers.Main`**: [viewmodel-state.md](viewmodel-state.md)
- **Capturing paused frames**: [screenshot-testing.md](screenshot-testing.md)
- **Timing-related flakiness**: [flaky-tests.md](../debugging/flaky-tests.md)
- **Timeouts and out-of-memory errors**: [common-errors.md](../debugging/common-errors.md)
