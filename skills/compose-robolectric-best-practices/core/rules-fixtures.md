# Rules & Fixtures

## Table of Contents

1. [Choosing a Setup Mechanism](#choosing-a-setup-mechanism)
2. [The Compose Rule](#the-compose-rule)
3. [Rule Order](#rule-order)
4. [@Before and @After](#before-and-after)
5. [Custom TestRule: MainDispatcherRule](#custom-testrule-maindispatcherrule)
6. [TemporaryFolder and Other JUnit Rules](#temporaryfolder-and-other-junit-rules)
7. [Sharing Setup Without Base Classes](#sharing-setup-without-base-classes)
8. [runComposeUiTest Instead of a Rule](#runcomposeuitest-instead-of-a-rule)
9. [Hilt](#hilt)
10. [Anti-Patterns](#anti-patterns)
11. [Related References](#related-references)

## Choosing a Setup Mechanism

JUnit 4 creates a new instance of the test class for every test method, so fields and rules are fresh per test. Use that before reaching for anything static.

| Need | Use |
| --- | --- |
| A host for composables | `@get:Rule val composeTestRule = createComposeRule()` (v2 import) |
| Setup that needs the compose rule (content, dispatcher) | `@Before` in the class, or a `TestRule` ordered after the compose rule |
| Setup and teardown reused across classes | A small custom `TestRule` (often a `TestWatcher`) |
| Files on disk | `TemporaryFolder` rule |
| A test that calls suspend functions itself | `runComposeUiTest { }` instead of a rule |
| Data the test reads | A builder or fake created in the test ([test-data.md](test-data.md)) |

## The Compose Rule

Use the v2 factories. The v1 `androidx.compose.ui.test.junit4.createComposeRule` is deprecated ([migration.md](../architecture/migration.md)).

| Factory | Hosts content in | Use when |
| --- | --- | --- |
| `createComposeRule()` | A `ComponentActivity` from `ui-test-manifest` | Most tests: `setContent { MyScreen() }` |
| `createAndroidComposeRule<A>()` | Activity `A` (must be in the merged manifest) | You need `composeTestRule.activity` or the activity sets its own content |
| `createEmptyComposeRule()` | Nothing; you launch an activity yourself | `ActivityScenario` tests ([activities-intents.md](../testing-patterns/activities-intents.md)) |

The rule must be a public property annotated `@get:Rule` (Kotlin puts `@Rule` on the getter). Structure and naming are in [test-structure.md](test-structure.md).

## Rule Order

Without `order`, JUnit does not define the order in which rules on one class wrap the test. Set `order` whenever one rule depends on another. **Lower `order` is outer**: it starts first and finishes last. Every rule starts before `@Before`, and finishes after `@After`.

```kotlin
import com.google.common.truth.Truth.assertThat
import org.junit.After
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TestWatcher
import org.junit.runner.Description
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

class Recording(private val name: String, private val log: MutableList<String>) : TestWatcher() {
    override fun starting(description: Description) { log += "start $name" }
    override fun finished(description: Description) { log += "finish $name" }
}

@RunWith(RobolectricTestRunner::class)
class RuleOrderTest {
    private val log = mutableListOf<String>()

    @get:Rule(order = 1) val inner = Recording("inner", log)
    @get:Rule(order = 0) val outer = Recording("outer", log)

    @Before fun setUp() { log += "before" }

    @After fun tearDown() {
        log += "after"
        assertThat(log).containsExactly("start outer", "start inner", "before", "after").inOrder()
    }

    @Test fun rulesWrapBeforeAndAfter() {
        assertThat(log).containsExactly("start outer", "start inner", "before").inOrder()
    }
}
```

`RuleChain` expresses the same thing in one field, which helps when a rule needs another rule as a constructor argument:

```kotlin snippet
private val composeTestRule = createComposeRule()

@get:Rule
val chain: RuleChain = RuleChain
    .outerRule(composeTestRule)              // starts first
    .around(MainDispatcherRule(composeTestRule))
```

Pick one style per class. Mixing `RuleChain` with ordered `@get:Rule` fields makes the order hard to read.

## @Before and @After

`@Before` runs inside every rule, so the compose rule is ready: you may call `setContent`, read `mainClock`, or set `Dispatchers.Main` there. Call `setContent` at most once per test ([test-structure.md](test-structure.md#setcontent-once-per-test)), so only put it in `@Before` when every test in the class renders the same content.

`@After` runs even when the test fails; if it also throws, JUnit reports both failures. Keep `@After` for undoing global state (`Dispatchers.resetMain()`, static singletons). The compose rule disposes the composition and closes the activity on its own.

## Custom TestRule: MainDispatcherRule

`Dispatchers.Main` under Robolectric is the main looper. That is enough for most screens, but delayed ViewModel work (`delay`, debounce) never finishes, because the Compose clock does not move the looper's clock ([viewmodel-state.md](../testing-patterns/viewmodel-state.md#dispatchersmain-under-robolectric)). Point `Dispatchers.Main` at a `StandardTestDispatcher` that **shares the compose rule's scheduler**, so `mainClock.advanceTimeBy` drives both.

A `TestWatcher` packages the set and reset for reuse. Order it inside the compose rule, and create the ViewModel inside the test, after the rule set `Main`:

```kotlin
import androidx.compose.material3.Text
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.ComposeTestRule
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.setMain
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TestWatcher
import org.junit.runner.Description
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

@OptIn(ExperimentalCoroutinesApi::class)
class MainDispatcherRule(private val composeTestRule: ComposeTestRule) : TestWatcher() {
    override fun starting(description: Description) {
        Dispatchers.setMain(StandardTestDispatcher(composeTestRule.mainClock.scheduler))
    }

    override fun finished(description: Description) {
        Dispatchers.resetMain()
    }
}

class ToastViewModel : ViewModel() {
    private val _message = MutableStateFlow("Saved")
    val message: StateFlow<String> = _message

    init {
        viewModelScope.launch {
            delay(3_000)
            _message.value = ""
        }
    }
}

@RunWith(RobolectricTestRunner::class)
class SavedMessageTest {
    @get:Rule(order = 0) val composeTestRule = createComposeRule()
    @get:Rule(order = 1) val mainDispatcherRule = MainDispatcherRule(composeTestRule)

    @Test
    fun savedMessage_disappearsAfterThreeSeconds() {
        composeTestRule.setContent {
            val viewModel = remember { ToastViewModel() }
            val message by viewModel.message.collectAsStateWithLifecycle()
            Text("Status: $message")
        }
        composeTestRule.onNodeWithText("Status: Saved").assertIsDisplayed()

        composeTestRule.mainClock.advanceTimeBy(3_000)

        composeTestRule.onNodeWithText("Status: ").assertIsDisplayed()
    }
}
```

Don't use the plain JVM form `Dispatchers.setMain(StandardTestDispatcher())` in a Compose test: that dispatcher has its own scheduler that nothing advances, so the ViewModel stays on its initial state. In a ViewModel test without Compose, that form plus `runTest` is the standard pattern ([viewmodel-state.md](../testing-patterns/viewmodel-state.md#viewmodel-tests-without-compose)).

## TemporaryFolder and Other JUnit Rules

Plain JUnit rules work under Robolectric. `TemporaryFolder` creates a directory before the test and deletes it afterwards, which keeps file-backed fakes isolated:

```kotlin
import com.google.common.truth.Truth.assertThat
import java.io.File
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

class DraftStore(private val dir: File) {
    fun save(text: String) = File(dir, "draft.txt").writeText(text)
    fun load(): String? = File(dir, "draft.txt").takeIf { it.exists() }?.readText()
}

@RunWith(RobolectricTestRunner::class)
class DraftStoreTest {
    @get:Rule val tempFolder = TemporaryFolder()

    @Test
    fun savedDraft_isLoadedBack() {
        val store = DraftStore(tempFolder.newFolder("drafts"))

        store.save("Hello")

        assertThat(store.load()).isEqualTo("Hello")
    }
}
```

Avoid `org.junit.rules.Timeout` with Robolectric: it spawns a new thread, which its Javadoc says is not compatible with Robolectric's scheduler. Robolectric 4.13 added `org.robolectric.junit.rules.TimeoutRule` (`TimeoutRule.seconds(40)`) as the replacement. For hangs in Compose tests, fix the wait instead ([synchronization.md](synchronization.md)).

## Sharing Setup Without Base Classes

A `BaseComposeTest` that owns rules, `@Before` methods, and helpers grows until every test pays for everything. Compose the pieces instead:

| Shared thing | Share it as |
| --- | --- |
| Set/reset global state | A `TestRule` each class opts into |
| Common content wrapper (theme, providers) | A `@Composable` helper: `setContent { TestTheme { Screen() } }` |
| Repeated interactions | A screen robot ([screen-robots.md](screen-robots.md)) |
| Default data | Builders with default arguments ([test-data.md](test-data.md)) |
| Robolectric config | `robolectric.properties` or a class `@Config` ([setup-configuration.md](setup-configuration.md#config-and-robolectricproperties)) |

```kotlin
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.ComposeContentTestRule
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

// Shared by every screen test: wraps content in the app's providers.
fun ComposeContentTestRule.setThemedContent(content: @Composable () -> Unit) =
    setContent { MaterialTheme(colorScheme = darkColorScheme()) { content() } }

@Composable
fun Greeting(name: String) = Text("Hello, $name")

@RunWith(RobolectricTestRunner::class)
class GreetingTest {
    @get:Rule val composeTestRule = createComposeRule()

    @Test
    fun greeting_showsName() {
        composeTestRule.setThemedContent { Greeting("Ada") }

        composeTestRule.onNodeWithText("Hello, Ada").assertIsDisplayed()
    }
}
```

Robolectric does search base classes for `@Config`, so a base class holding only `@Config` is harmless. Keep rules and state out of it.

## runComposeUiTest Instead of a Rule

`runComposeUiTest` (v2, `@ExperimentalTestApi`) sets up the same environment per test without a rule, and runs the block in `runTest` on the Compose scheduler. Use it when the test itself calls suspend functions. Rules are the better fit when the class also needs other rules, because a rule-based class can order them ([test-structure.md](test-structure.md#runcomposeuitest)).

| | `createComposeRule()` | `runComposeUiTest { }` |
| --- | --- | --- |
| Scope | Every test in the class | One test |
| Other rules (`TemporaryFolder`, Hilt, Roborazzi) | Ordered with `order` | Still possible as rules, but they wrap the whole function |
| Suspend calls in the test | Need a separate `runTest`: two clocks | Direct, one clock |
| Stability | Stable | `@ExperimentalTestApi` in 1.12.1 |

## Hilt

Hilt is outside this skill's harness. When a test uses it, `HiltAndroidRule` must run first, so give it `order = 0` and the compose rule `order = 1` (the order Hilt's testing guide uses), then call `hiltRule.inject()` in `@Before`:

```kotlin snippet
@HiltAndroidTest
class SettingsScreenTest {
    @get:Rule(order = 0) val hiltRule = HiltAndroidRule(this)
    @get:Rule(order = 1) val composeTestRule = createAndroidComposeRule<HiltTestActivity>()

    @Before fun init() { hiltRule.inject() }
}
```

`HiltTestActivity` is an empty `@AndroidEntryPoint` activity that must be in a manifest Robolectric can see (a debug source set), because test-only activities are not in the merged manifest.

## Anti-Patterns

| Anti-pattern | Problem | Do instead |
| --- | --- | --- |
| Several `@get:Rule` fields without `order` when one depends on another | Order is unspecified | `order = 0, 1, …` or `RuleChain` |
| `Dispatchers.setMain(StandardTestDispatcher())` in a Compose test | ViewModel coroutines never run | Share `mainClock.scheduler` |
| ViewModel created in a field initializer while a rule sets `Main` | Its `init` launches on the real `Main` before the rule runs | Create it in the test or `setContent` |
| `companion object` / `@BeforeClass` state | Leaks between tests; Robolectric resets the app, not your statics | Instance fields, reset in `@After` |
| A deep `BaseTest` hierarchy | Every test pays for every rule; hidden setup | Opt-in rules, helpers, robots |
| `setContent` in `@Before` plus in a test | Second call throws | One `setContent` per test |
| `org.junit.rules.Timeout` | Spawns a thread Robolectric's scheduler does not expect | `TimeoutRule`, or fix the wait |

## Related References

- [test-structure.md](test-structure.md): rule factories, `runComposeUiTest`, naming
- [synchronization.md](synchronization.md): the test clock and dispatchers
- [viewmodel-state.md](../testing-patterns/viewmodel-state.md): `Dispatchers.Main` and ViewModels
- [screen-robots.md](screen-robots.md), [test-data.md](test-data.md): sharing steps and data
- [setup-configuration.md](setup-configuration.md): `@Config` and `robolectric.properties`
