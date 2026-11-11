# Synchronization

## Table of Contents

1. [What Auto-Synchronization Does](#what-auto-synchronization-does)
2. [What It Does Not Wait For](#what-it-does-not-wait-for)
3. [Choosing a Wait](#choosing-a-wait)
4. [waitForIdle, runOnIdle, runOnUiThread](#waitforidle-runonidle-runonuithread)
5. [waitUntil Helpers](#waituntil-helpers)
6. [The Test Clock](#the-test-clock)
7. [v1 vs v2 Dispatchers](#v1-vs-v2-dispatchers)
8. [Coroutines from LaunchedEffect and rememberCoroutineScope](#coroutines-from-launchedeffect-and-remembercoroutinescope)
9. [Idling Resources](#idling-resources)
10. [Robolectric PAUSED Looper](#robolectric-paused-looper)
11. [Never Thread.sleep](#never-threadsleep)
12. [Anti-Patterns to Avoid](#anti-patterns-to-avoid)

## What Auto-Synchronization Does

Compose tests run against a **virtual clock** (`mainClock`), not real time. Every finder-based action and assertion first synchronizes: it waits until the UI is idle, advancing the virtual clock frame by frame while Compose has work to do. That covers:

- pending recompositions after state changes (from the test, a click, or a coroutine that already resumed),
- layout and draw passes,
- animations and transitions that finish (each frame advances the clock by about 16ms),
- tasks posted to the main looper **without** a delay (`Handler.post`, `View.post`),
- registered [idling resources](#idling-resources).

Without a synchronizing call, nothing recomposes. A test that changes state and reads a plain variable sees the old value; an assertion through the rule sees the new one:

```kotlin
import androidx.compose.material3.Text
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

@RunWith(RobolectricTestRunner::class)
class AutoSyncTest {
    @get:Rule
    val composeTestRule = createComposeRule()

    @Test
    fun stateChange_isRecomposedOnTheNextSync() {
        val counter = mutableIntStateOf(0)
        var lastComposed = -1
        composeTestRule.setContent {
            Text("Count ${counter.intValue}")
            lastComposed = counter.intValue
        }

        counter.intValue = 1
        assertEquals(0, lastComposed)

        composeTestRule.onNodeWithText("Count 1").assertIsDisplayed()
        assertEquals(1, lastComposed)
    }
}
```

## What It Does Not Wait For

Idle means "Compose has no frame to produce and the main looper has nothing due **now**". These are not counted as busy, so an assertion right after them sees the old UI:

| Source | Why it is not awaited | Wait with |
| --- | --- | --- |
| `delay(…)` in `LaunchedEffect` or a launched coroutine | A suspended timer is not pending work; `waitForIdle()` does not advance to it | `mainClock.advanceTimeBy(ms)` (exact), or `waitUntil…` for short delays |
| `Handler.postDelayed` / `View.postDelayed` | Not due yet on Robolectric's paused looper | `waitUntil…`, or `shadowOf(Looper.getMainLooper()).idleFor(…)` |
| Work on another thread (`Dispatchers.IO`, executors, OkHttp) | Compose cannot see it | Inject a test dispatcher (best), `waitUntil…`, or an idling resource |
| `Flow`s or ViewModels on `Dispatchers.Main` / `viewModelScope` | Run on Robolectric's main looper, not the Compose test dispatcher | See [viewmodel-state.md](../testing-patterns/viewmodel-state.md) |

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
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

@RunWith(RobolectricTestRunner::class)
class DelayIsNotAwaitedTest {
    @get:Rule
    val composeTestRule = createComposeRule()

    @Test
    fun delay_needsTheClockAdvanced() {
        composeTestRule.setContent {
            var status by remember { mutableStateOf("Connecting…") }
            LaunchedEffect(Unit) {
                delay(1_000)
                status = "Connected"
            }
            Text(status)
        }

        composeTestRule.waitForIdle()
        composeTestRule.onNodeWithText("Connecting…").assertIsDisplayed()
        assertEquals(0L, composeTestRule.mainClock.currentTime)

        composeTestRule.mainClock.advanceTimeBy(1_000)

        composeTestRule.onNodeWithText("Connected").assertIsDisplayed()
    }
}
```

Being able to see "Connecting…" is the point: v2 tests observe intermediate states instead of jumping past them.

## Choosing a Wait

| Situation | Use |
| --- | --- |
| State changed, a click happened, an animation runs | Nothing. The next assertion or action synchronizes |
| A known `delay` / timeout in Compose code | `mainClock.advanceTimeBy(ms)` |
| A node should appear or disappear after async work | `waitUntilExactlyOneExists(matcher)`, `waitUntilDoesNotExist(matcher)` |
| A non-UI condition (a fake received a call) after async work | `waitUntil { condition }` |
| Background threads the app owns | Inject a test dispatcher; otherwise an `IdlingResource` |
| Asserting on non-Compose state after Compose settled | `runOnIdle { … }` |
| Step through frames of an animation | `mainClock.autoAdvance = false` + `advanceTimeByFrame()` ([animations-clock.md](../testing-patterns/animations-clock.md)) |

## waitForIdle, runOnIdle, runOnUiThread

| API | Does |
| --- | --- |
| `waitForIdle()` | Synchronizes once. With `autoAdvance = true` (default) it advances the clock until Compose is idle; with `autoAdvance = false` it only waits for idling resources and pending layout/draw |
| `runOnIdle { }` | `waitForIdle()`, then runs the block on the UI thread and returns its value |
| `runOnUiThread { }` | Runs the block on the UI thread without waiting |
| `awaitIdle()` | Suspending `waitForIdle`, for `runComposeUiTest` or `runTest` bodies |

Under Robolectric the test already runs on the main thread, so `runOnUiThread` runs inline. Write tests as if threads differed anyway; the same code then works as an instrumented test.

You rarely need an explicit `waitForIdle()` before a Compose assertion; use it before reading **non-Compose** state, or use `runOnIdle`:

```kotlin snippet
composeTestRule.onNodeWithText("Save").performClick()
composeTestRule.runOnIdle { assertThat(fakeRepository.saved).containsExactly(draft) }
```

## waitUntil Helpers

`waitUntil(timeoutMillis = 1_000) { condition }` re-checks `condition` while advancing the virtual clock and idling the main looper, until it is true or the timeout elapses. The timeout is **wall-clock** time, and the virtual clock advances at roughly the same rate, so a 1s default timeout covers about 1s of virtual time. The node helpers wrap common conditions and are `@ExperimentalTestApi`:

| Helper | Waits until |
| --- | --- |
| `waitUntilExactlyOneExists(matcher, timeoutMillis = 1_000)` | One node matches |
| `waitUntilAtLeastOneExists(matcher, timeoutMillis = 1_000)` | At least one node matches |
| `waitUntilDoesNotExist(matcher, timeoutMillis = 1_000)` | No node matches |
| `waitUntilNodeCount(matcher, count, timeoutMillis = 1_000)` | Exactly `count` nodes match |
| `waitUntil(conditionDescription, timeoutMillis) { }` | The condition; the description is added to the timeout message |

```kotlin
import androidx.compose.foundation.layout.Column
import androidx.compose.material3.Button
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.test.ExperimentalTestApi
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

class SlowGreetingService {
    fun fetch(): String {
        Thread.sleep(100)
        return "Hello, Ada"
    }
}

@Composable
fun GreetingLoader(service: SlowGreetingService) {
    val scope = rememberCoroutineScope()
    var greeting by remember { mutableStateOf<String?>(null) }
    Column {
        Button(onClick = { scope.launch { greeting = withContext(Dispatchers.IO) { service.fetch() } } }) {
            Text("Load")
        }
        greeting?.let { Text(it) }
    }
}

@OptIn(ExperimentalTestApi::class)
@RunWith(RobolectricTestRunner::class)
class WaitUntilTest {
    @get:Rule
    val composeTestRule = createComposeRule()

    @Test
    fun load_showsGreetingFromBackgroundThread() {
        composeTestRule.setContent { GreetingLoader(SlowGreetingService()) }

        composeTestRule.onNodeWithText("Load").performClick()

        composeTestRule.waitUntilExactlyOneExists(hasText("Hello, Ada"), timeoutMillis = 5_000)
    }
}
```

- The `Thread.sleep` here stands in for a slow production call on a real background thread. It is not how tests should wait.
- Give background-thread waits a generous `timeoutMillis` (several seconds). A loaded CI machine is slower than your laptop, and a passing wait returns as soon as the condition holds.
- For long **virtual** delays (a 30s retry timer), `waitUntil` would need 30s of wall time. Use `mainClock.advanceTimeBy(30_000)` instead.
- Better than either: inject the dispatcher into the code under test so the test controls it and no real thread is involved ([viewmodel-state.md](../testing-patterns/viewmodel-state.md), [test-data.md](test-data.md)).
- On timeout `waitUntil` throws `ComposeTimeoutException: Condition still not satisfied after 1000 ms`.

## The Test Clock

`composeTestRule.mainClock` (a `MainTestClock`) drives recomposition, animations, gestures, and the composition's coroutine delays.

| Member | Does |
| --- | --- |
| `currentTime` | Virtual time in ms since the test started |
| `autoAdvance` (default `true`) | Whether synchronization advances the clock automatically |
| `advanceTimeByFrame()` | One frame (about 16ms) |
| `advanceTimeBy(ms, ignoreFrameDuration = false)` | `ms`, rounded up to whole frames unless `ignoreFrameDuration` |
| `advanceTimeUntil(timeoutMillis = 1_000) { condition }` | Frame by frame until the condition holds; `timeoutMillis` is **virtual** time. The condition should read Compose state |
| `scheduler` | The `TestCoroutineScheduler` of the v2 dispatcher; `scheduler.runCurrent()` runs coroutines queued at the current time without advancing it |

Injected gestures move the clock too: a `longClick()` advances it by the long-press duration.

With `autoAdvance = false`, the test owns time. Coroutines resume when you advance past their delay, but the UI shows the change only after a frame:

```kotlin
import androidx.compose.foundation.layout.Column
import androidx.compose.material3.Button
import androidx.compose.material3.Text
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

@RunWith(RobolectricTestRunner::class)
class ManualClockTest {
    @get:Rule
    val composeTestRule = createComposeRule()

    @Test
    fun save_showsSavingThenSaved() {
        composeTestRule.setContent {
            val scope = rememberCoroutineScope()
            var status by remember { mutableStateOf("Idle") }
            Column {
                Button(onClick = {
                    scope.launch {
                        status = "Saving…"
                        delay(500)
                        status = "Saved"
                    }
                }) { Text("Save") }
                Text(status)
            }
        }
        composeTestRule.mainClock.autoAdvance = false

        composeTestRule.onNodeWithText("Save").performClick()
        composeTestRule.mainClock.advanceTimeByFrame()
        composeTestRule.onNodeWithText("Saving…").assertIsDisplayed()

        composeTestRule.mainClock.advanceTimeBy(500)
        composeTestRule.onNodeWithText("Saved").assertIsDisplayed()
    }
}
```

`hasPendingWork()` returns whether Compose still has work queued, without waiting or advancing; use it to step until an animation ends. `runWithoutImplicitWait { }` skips synchronization for many reads in one frame. Both are for frame-by-frame animation tests ([animations-clock.md](../testing-patterns/animations-clock.md)).

## v1 vs v2 Dispatchers

The v2 entry points (`junit4.v2.createComposeRule`, `v2.runComposeUiTest`, …) run the composition's coroutines on a `StandardTestDispatcher`. The deprecated v1 ones used an `UnconfinedTestDispatcher`.

| | v1 (deprecated) | v2 |
| --- | --- | --- |
| A launched coroutine | Runs immediately, up to its first suspension | Is queued; runs when the scheduler runs (any synchronization does this) |
| Intermediate states ("Saving…") | Often skipped before the test can see them | Observable |
| `delay` | Advanced by the clock | Advanced by the clock |
| Tests that read non-Compose state right after an action | Often passed by accident | Need `waitForIdle()` / `runOnIdle` first |

The typical migration failure is reading state directly after triggering work:

```kotlin compile-only
import androidx.compose.ui.test.junit4.v2.createComposeRule
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test

class Counter { var value = 0 }

class V2MigrationExample {
    @get:Rule
    val composeTestRule = createComposeRule()

    private val counter = Counter()

    @Test
    fun readsTooEarly() {
        // ❌ Under v2 a coroutine launched by the click has only been queued here.
        assertEquals(1, counter.value)
    }

    @Test
    fun readsAfterIdle() {
        // ✅ runOnIdle runs queued work first.
        composeTestRule.runOnIdle { assertEquals(1, counter.value) }
    }
}
```

`createComposeRule()` plus a separate `runTest { }` creates **two** schedulers: advancing the `runTest` one does not move Compose. Use `runComposeUiTest`, whose body runs in `runTest` on the same scheduler ([test-structure.md](test-structure.md#runcomposeuitest)), or pass `composeTestRule.mainClock.scheduler` to the code that needs it. Migration steps are in [migration.md](../architecture/migration.md).

## Coroutines from LaunchedEffect and rememberCoroutineScope

Both use the composition's coroutine context, so they run on the test dispatcher and the test clock:

| Code | Behavior in a v2 test |
| --- | --- |
| `LaunchedEffect(key) { state = load() }` with no delay | Runs during the next synchronization |
| `scope.launch { … }` in `onClick` with no delay | Runs during the synchronization of the next action or assertion |
| `delay(ms)` in either | Resumes only when the clock passes it: `advanceTimeBy`, `waitUntil…`, or `advanceTimeUntil` |
| `withContext(Dispatchers.IO) { … }` in either | The block runs on a real thread; wait with `waitUntil…` |
| An endless loop of `withFrameNanos` (infinite transitions are paused by the test rule and do not block) | Never idle; actions hang about 60s, then fail with `AppNotIdleException: Compose did not get idle` ([animations-clock.md](../testing-patterns/animations-clock.md)) |

## Idling Resources

When the app does background work that the test cannot inject a dispatcher into, expose the "busy" state as an `androidx.compose.ui.test.IdlingResource` and register it. Every synchronization then also waits until `isIdleNow` is `true`.

```kotlin
import androidx.compose.foundation.layout.Column
import androidx.compose.material3.Button
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.test.IdlingResource
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import org.junit.After
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicInteger

class ReportGenerator {
    private val executor = Executors.newSingleThreadExecutor()
    private val inFlight = AtomicInteger(0)

    val idlingResource = object : IdlingResource {
        override val isIdleNow: Boolean get() = inFlight.get() == 0
        override fun getDiagnosticMessageIfBusy() = "$inFlight report(s) in progress"
    }

    fun generate(onDone: (String) -> Unit) {
        inFlight.incrementAndGet()
        executor.execute {
            Thread.sleep(50)
            onDone("Report ready")
            inFlight.decrementAndGet()
        }
    }

    fun shutdown() = executor.shutdown()
}

@Composable
fun ReportScreen(generator: ReportGenerator) {
    var status by remember { mutableStateOf("No report") }
    Column {
        Button(onClick = { generator.generate { status = it } }) { Text("Generate") }
        Text(status)
    }
}

@RunWith(RobolectricTestRunner::class)
class IdlingResourceTest {
    @get:Rule
    val composeTestRule = createComposeRule()

    private val generator = ReportGenerator()

    @After
    fun tearDown() {
        composeTestRule.unregisterIdlingResource(generator.idlingResource)
        generator.shutdown()
    }

    @Test
    fun generate_showsReportWhenWorkerFinishes() {
        composeTestRule.setContent { ReportScreen(generator) }
        composeTestRule.registerIdlingResource(generator.idlingResource)

        composeTestRule.onNodeWithText("Generate").performClick()

        composeTestRule.onNodeWithText("Report ready").assertIsDisplayed()
    }
}
```

- A resource that is busy when `setContent` runs (or that never becomes idle) blocks synchronization until it times out after about 60s with `AppNotIdleException: Compose did not get idle`. Register after `setContent` if the resource can start busy, and make sure it always returns to idle.
- Unregister in `@After` so a resource cannot leak into later tests.
- On `ComposeUiTest` (`runComposeUiTest`), `registerIdlingResource` and `unregisterIdlingResource` are extension functions imported from `androidx.compose.ui.test`.
- Espresso `IdlingResource`s registered with `IdlingRegistry` are a different API; Compose test rules also wait for Espresso's idling, which matters for View interop ([interop-views.md](../testing-patterns/interop-views.md)).
- An idling resource is a fallback. A test dispatcher passed to the code under test is simpler and deterministic.

## Robolectric PAUSED Looper

Robolectric's default `LooperMode.PAUSED` mirrors Android's threading closely, with two differences that matter here:

- **The test runs on the main looper thread.** Main-looper tasks run only when the looper is idled.
- **`SystemClock` is frozen.** It advances only through Robolectric APIs such as `ShadowLooper.idleFor`; `Thread.sleep` does not move it.

Compose's synchronization idles the main looper for you, so `Handler.post { }` work runs before the next assertion. Tasks posted **with a delay** are not due on the frozen clock and do not run during `waitForIdle()`:

```kotlin
import android.os.Handler
import android.os.Looper
import androidx.compose.material3.Text
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import java.time.Duration

@RunWith(RobolectricTestRunner::class)
class PausedLooperTest {
    @get:Rule
    val composeTestRule = createComposeRule()

    @Test
    fun handlerPostDelayed_runsWhenTheLooperIsAdvanced() {
        composeTestRule.setContent {
            var message by remember { mutableStateOf("Copied!") }
            LaunchedEffect(Unit) {
                Handler(Looper.getMainLooper()).postDelayed({ message = "" }, 2_000)
            }
            Text(message.ifEmpty { "Copy" })
        }
        composeTestRule.waitForIdle()
        composeTestRule.onNodeWithText("Copied!").assertIsDisplayed()

        shadowOf(Looper.getMainLooper()).idleFor(Duration.ofMillis(2_000))

        composeTestRule.onNodeWithText("Copy").assertIsDisplayed()
    }
}
```

| You should need `shadowOf(Looper.getMainLooper())` | You should not |
| --- | --- |
| Non-Compose code posts **delayed** work to the main looper (`Handler.postDelayed`, `View.postDelayed`, `Choreographer` callbacks from Views) and you want it to run at an exact time | Recomposition, state changes, clicks, `LaunchedEffect`, Compose animations: the rule handles them |
| Robolectric-only code with no Compose rule in the test | `Handler.post` without a delay: synchronization idles the looper |

`idle()` runs everything due now; `idleFor(duration)` advances the Robolectric clock and runs what becomes due; `runToEndOfTasks()` runs everything queued, advancing the clock as needed. If a `waitUntil…` would do, prefer it: it also idles the looper.

## Never Thread.sleep

`Thread.sleep` in a test waits real time, which does not advance the Compose clock, Robolectric's `SystemClock`, or delayed looper tasks. It makes tests slow, and they still fail or pass by luck:

```kotlin compile-only
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import org.junit.Rule
import org.junit.Test

class SleepAntiPattern {
    @get:Rule
    val composeTestRule = createComposeRule()

    @Test
    fun waitsWithSleep() {
        // ❌ Real time passes; virtual time and Robolectric's clock do not.
        Thread.sleep(2_000)
        composeTestRule.onNodeWithText("Connected").assertIsDisplayed()
    }

    @Test
    fun advancesTheClock() {
        // ✅ Moves the time the code under test sees.
        composeTestRule.mainClock.advanceTimeBy(2_000)
        composeTestRule.onNodeWithText("Connected").assertIsDisplayed()
    }
}
```

`CountDownLatch.await()` and similar blocking waits have the same problem: the clock does not advance while the test thread is blocked, and on Robolectric the blocked thread is the main thread. Use `waitUntil` with the latch's count as the condition.

## Anti-Patterns to Avoid

| Anti-Pattern | Problem | Solution |
| --- | --- | --- |
| `Thread.sleep(…)` | Real time only; slow and flaky | `advanceTimeBy`, `waitUntil…` |
| `waitForIdle()` to get past a `delay` | Does not advance to suspended timers | `mainClock.advanceTimeBy(ms)` |
| `waitUntil` for a long virtual delay | Advances about as fast as wall time; times out | `advanceTimeBy` |
| Default 1s timeout for real background work | Flaky on slow CI | `timeoutMillis` of a few seconds, or inject a dispatcher |
| `runTest { advanceTimeBy(…) }` beside `createComposeRule()` | Separate scheduler; Compose time does not move | `runComposeUiTest`, or `mainClock` |
| Reading a fake right after `performClick()` | Launched work is only queued under v2 | `runOnIdle { }` |
| An idling resource that starts busy before `setContent` | `setContent` blocks ~60s, then `AppNotIdleException` | Register after `setContent`; always return to idle |
| Forgetting to unregister an idling resource | Leaks into later tests | Unregister in `@After` |
| `shadowOf(mainLooper).idle()` sprinkled after every action | Compose already idles the looper | Only for delayed non-Compose tasks |
| `autoAdvance = false` without advancing | The UI never updates; assertions see stale state | Advance frames, or restore `autoAdvance = true` |

## Related References

- **Animations, infinite transitions, frame stepping**: [animations-clock.md](../testing-patterns/animations-clock.md)
- **ViewModels, StateFlow, `Dispatchers.Main`**: [viewmodel-state.md](../testing-patterns/viewmodel-state.md)
- **Choosing a rule or `runComposeUiTest`**: [test-structure.md](test-structure.md)
- **Flaky tests**: [flaky-tests.md](../debugging/flaky-tests.md)
- **Migrating from v1**: [migration.md](../architecture/migration.md)
- **Robolectric looper and graphics modes**: [setup-configuration.md](setup-configuration.md#looper-and-graphics-modes)
