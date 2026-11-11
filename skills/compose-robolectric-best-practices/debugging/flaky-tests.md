# Flaky Tests

## Table of Contents

1. [Flakiness Categories](#flakiness-categories)
2. [Reproducing Flakiness](#reproducing-flakiness)
3. [Static State and Test Order](#static-state-and-test-order)
4. [Work on Real Threads](#work-on-real-threads)
5. [Dispatchers.Main](#dispatchersmain)
6. [Real Time and Thread.sleep](#real-time-and-threadsleep)
7. [Animations and Delays](#animations-and-delays)
8. [Retries: Last Resort](#retries-last-resort)
9. [Related References](#related-references)

## Flakiness Categories

Robolectric tests are single-threaded and use virtual clocks, so a Compose test that only touches Compose state is deterministic. Flakiness comes from the parts that escape that model:

| Category | Symptom | Common causes |
| --- | --- | --- |
| **Order-dependent** | Passes alone, fails in the suite or after another class | Singletons, `object`s, companion state, caches; `Dispatchers.setMain` without `resetMain` |
| **Real threads** | Intermittent "could not find any node" | `Dispatchers.IO`/`Default`, executors, OkHttp, Room on real threads |
| **Real time** | Fails at certain times of day or on slow CI | `System.currentTimeMillis()`, `Calendar.getInstance()`, time zone, `Thread.sleep` |
| **Clock assumptions** | Value off by a frame, or animation half done | Exact mid-animation values, `advanceTimeBy` rounding, `delay` vs frames |
| **Environment** | Fails on one machine | Default locale/time zone of the JVM, JDK version, first-run SDK download |

```
Test fails intermittently
├─ Fails alone when repeated? → real threads or real time
├─ Passes alone, fails in the suite? → static state / test order
├─ Fails only in CI? → time zone, locale, JDK, resources
└─ Fails mid-animation? → clock assumptions (animations-clock.md)
```

## Reproducing Flakiness

```bash
# Run one test many times; stop at the first failure
for i in $(seq 1 30); do
  ./gradlew :app:testDebugUnitTest --tests 'com.example.CartScreenTest' --rerun -q || break
done

# Same test alone, then with the class or package it fails next to
./gradlew :app:testDebugUnitTest --tests 'com.example.CartScreenTest'
./gradlew :app:testDebugUnitTest --tests 'com.example.*'
```

`--rerun` forces the test task to run even when Gradle considers it up to date. If a test passes alone and fails in the suite, isolate each test class in its own JVM to confirm shared static state:

```kts
// app/build.gradle.kts, temporarily
android {
    testOptions {
        unitTests.all {
            it.forkEvery = 1
        }
    }
}
```

`forkEvery = 1` starts a new JVM per test class. It is slow, so use it to diagnose, then fix the leak ([performance.md](../infrastructure-ci-cd/performance.md)).

## Static State and Test Order

Robolectric gives every test a fresh `Application`, resets its shadows, and launches a new activity for the Compose rule. It does not reset your own static state: test classes share a JVM and the classes loaded in it. With the pinned stack a value written to a Kotlin `object` in one test class was still there in the next class, and the second test failed until `forkEvery = 1` separated them.

```kotlin compile-only
import androidx.compose.material3.Text
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

object Session {
    var userName: String? = null
}

@RunWith(RobolectricTestRunner::class)
class SignedInHeaderTest {
    @get:Rule val composeTestRule = createComposeRule()

    @Test
    fun greetsTheUser() {
        Session.userName = "Ada" // BAD: leaks into every later test in this JVM
        composeTestRule.setContent { Text("Hi ${Session.userName ?: "guest"}") }
        composeTestRule.onNodeWithText("Hi Ada").assertExists()
    }
}

@RunWith(RobolectricTestRunner::class)
class GuestHeaderTest {
    @get:Rule val composeTestRule = createComposeRule()

    @Test
    fun greetsAGuest() {
        composeTestRule.setContent { Text("Hi ${Session.userName ?: "guest"}") }
        composeTestRule.onNodeWithText("Hi guest").assertExists() // fails after SignedInHeaderTest
    }
}
```

Best fix: pass the value in instead of reading a global, so each test builds its own. When the global cannot go yet, reset it around every test:

```kotlin
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import org.junit.After
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

object Session {
    var userName: String? = null
}

@Composable
fun Header(userName: String?) {
    Text("Hi ${userName ?: "guest"}")
}

@RunWith(RobolectricTestRunner::class)
class HeaderTest {
    @get:Rule val composeTestRule = createComposeRule()

    @After
    fun resetSession() {
        Session.userName = null
    }

    @Test
    fun greetsTheUser() {
        composeTestRule.setContent { Header(userName = "Ada") }
        composeTestRule.onNodeWithText("Hi Ada").assertIsDisplayed()
    }

    @Test
    fun greetsAGuest() {
        composeTestRule.setContent { Header(userName = Session.userName) }
        composeTestRule.onNodeWithText("Hi guest").assertIsDisplayed()
    }
}
```

| Leak | Fix |
| --- | --- |
| `object` / companion fields, service locators | Inject; or reset in `@After` |
| In-memory caches and fake repositories kept in a static | Create a new fake per test ([test-data.md](../core/test-data.md)) |
| `Dispatchers.setMain` | `Dispatchers.resetMain()` in `@After` ([below](#dispatchersmain)) |
| `Intents.init()` | `Intents.release()` in `@After` ([activities-intents.md](../testing-patterns/activities-intents.md#verifying-outgoing-intents)) |
| Registered idling resources | Unregister in `@After` ([synchronization.md](../core/synchronization.md#idling-resources)) |
| `ShadowLog.stream`, `Locale.setDefault`, `TimeZone.setDefault` | Restore the old value in `@After` |

JUnit 4 runs methods in a fixed but unspecified order. Do not rely on it, and do not "fix" a leak with `@FixMethodOrder`.

## Work on Real Threads

Compose synchronization waits for composition, the main looper, and registered idling resources. Work on another thread is invisible to it. A `LaunchedEffect` that loaded data with `withContext(Dispatchers.IO)` failed an immediate `assertExists()` with the pinned stack, and passed with `waitUntil`. When the background work is quick it can finish before the assertion and pass, which is what makes this pattern flaky rather than consistently red.

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
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithText
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

fun interface OrderSource {
    fun load(): String
}

@Composable
fun OrderStatus(source: OrderSource, ioDispatcher: CoroutineDispatcher = Dispatchers.IO) {
    var status by remember { mutableStateOf("Loading") }
    LaunchedEffect(source) { status = withContext(ioDispatcher) { source.load() } }
    Text(status)
}

@RunWith(RobolectricTestRunner::class)
class OrderStatusTest {
    @get:Rule val composeTestRule = createComposeRule()

    @Test
    fun injectedDispatcherKeepsWorkOnTheTestThread() {
        composeTestRule.setContent {
            OrderStatus(source = { "Shipped" }, ioDispatcher = Dispatchers.Main)
        }
        composeTestRule.onNodeWithText("Shipped").assertIsDisplayed()
    }

    @Test
    fun realDispatcherNeedsAnExplicitWait() {
        composeTestRule.setContent { OrderStatus(source = { "Shipped" }) }
        composeTestRule.waitUntil(timeoutMillis = 5_000) {
            composeTestRule.onAllNodesWithText("Shipped").fetchSemanticsNodes().isNotEmpty()
        }
        composeTestRule.onNodeWithText("Shipped").assertIsDisplayed()
    }
}
```

Prefer injecting the dispatcher (or the repository, as a fake that returns immediately). Use `waitUntil` when you cannot, and an idling resource for long-running background work the app cannot expose otherwise ([synchronization.md](../core/synchronization.md)).

## Dispatchers.Main

`Dispatchers.setMain(…)` replaces `Dispatchers.Main` for the whole JVM until `Dispatchers.resetMain()`. Always pair them in `@Before` / `@After` (or a JUnit rule) so a failure cannot leave the replacement installed for the next class. When a test does install a test dispatcher for ViewModels, build it on `composeTestRule.mainClock.scheduler` so the Compose clock drives it; [viewmodel-state.md](../testing-patterns/viewmodel-state.md#dispatchersmain-under-robolectric) shows the setup and what a plain `StandardTestDispatcher()` does instead.

## Real Time and Thread.sleep

Three clocks exist in a Robolectric Compose test, and only one moves with real time:

| Clock | Moves when | Seen with the pinned stack |
| --- | --- | --- |
| `composeTestRule.mainClock` | Synchronization, `advanceTimeBy`, `waitUntil` | — |
| `SystemClock.uptimeMillis()` (Robolectric, PAUSED looper) | `shadowOf(Looper.getMainLooper()).idleFor(…)` and similar | Unchanged by `Thread.sleep(50)` and by `mainClock.advanceTimeBy(1_000)` |
| `System.currentTimeMillis()`, `Calendar`, `Instant.now()` | Real time | Advanced by 53 ms across `Thread.sleep(50)` |

Code that reads the wall clock depends on when the test runs: inject a fixed time source ([animations-clock.md](../testing-patterns/animations-clock.md#wall-clock-time)). Set the time zone and locale in the fake or test, not from the CI machine.

`Thread.sleep` never helps: it does not advance the Compose clock or Robolectric's `SystemClock`, it only slows the suite. Work on real threads may finish during the sleep, which makes the test pass on fast machines and fail on slow ones.

```kotlin compile-only
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

@RunWith(RobolectricTestRunner::class)
class SleepyTest {
    @get:Rule val composeTestRule = createComposeRule()

    @Test
    fun savesDraft() {
        composeTestRule.onNodeWithText("Save").performClick()
        Thread.sleep(1_000) // BAD: neither clock moves; real threads race
        composeTestRule.onNodeWithText("Saved").assertExists()
    }
}
```

Replace it with `mainClock.advanceTimeBy` for Compose delays, `waitUntil` for real-thread work, or `idleFor` for delayed main-looper tasks ([synchronization.md](../core/synchronization.md#never-threadsleep)).

## Animations and Delays

Compose animations on the test clock are deterministic, but tests about them can still be fragile:

- Asserting exact values mid-animation breaks when the start frame shifts. Assert ranges or the end state.
- `advanceTimeBy` rounds up to whole 16 ms frames; a boundary like 3999 ms lands on 4000 ms.
- A hand-written `withFrameNanos` loop never goes idle; the test fails with `AppNotIdleException` after about 60 seconds.

All three are covered with examples in [animations-clock.md](../testing-patterns/animations-clock.md).

## Retries: Last Resort

Retrying a flaky test in CI hides the cause and doubles the cost of real failures. Reproduce it with the loop above, find which category it is in, and fix it. If a retry is unavoidable for a short time, track the test (an issue and an `@Ignore` with a reason are more honest than a silent retry; see [annotations-filtering.md](../core/annotations-filtering.md)).

## Related References

- **Finding why a node is missing**: [debugging.md](debugging.md)
- **Waiting correctly**: [synchronization.md](../core/synchronization.md)
- **ViewModel dispatchers**: [viewmodel-state.md](../testing-patterns/viewmodel-state.md)
- **Rules and teardown**: [rules-fixtures.md](../core/rules-fixtures.md)
- **CI-only failures**: [ci.md](../infrastructure-ci-cd/ci.md)
