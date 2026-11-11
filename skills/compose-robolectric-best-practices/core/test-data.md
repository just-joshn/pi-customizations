# Test Data

## Table of Contents

1. [Principles](#principles)
2. [Builders with Default Arguments](#builders-with-default-arguments)
3. [In-Memory Fake Repositories](#in-memory-fake-repositories)
4. [Deterministic Time and IDs](#deterministic-time-and-ids)
5. [UI State Fixtures for Stateless Composables](#ui-state-fixtures-for-stateless-composables)
6. [Strings and Resources](#strings-and-resources)
7. [Anti-Patterns](#anti-patterns)
8. [Related References](#related-references)

## Principles

- **Each test builds its own data.** JUnit creates a new test class instance per test, so data in instance fields or local variables is already isolated. Shared mutable objects in a `companion object` are not.
- **State only what the test is about.** Defaults cover the rest, so the reader sees `aUser(name = "Ada")` and knows the name matters.
- **Use values the user sees.** Finders match text, so pick distinct, readable values (`"Ada Lovelace"`, not `"test1"`), which also makes failures readable.
- **Make it deterministic.** No `System.currentTimeMillis()`, `Random`, or `UUID.randomUUID()` in data that reaches the screen.

## Builders with Default Arguments

Kotlin default and named arguments are the builder. A top-level function per domain type, with realistic defaults, replaces most factory libraries. Use `copy()` to derive variants.

```kotlin
import androidx.compose.foundation.layout.Column
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

data class Order(val id: String, val customer: String, val itemCount: Int, val shipped: Boolean)

// Test builder: every argument has a sensible default.
fun anOrder(
    id: String = "order-1",
    customer: String = "Ada Lovelace",
    itemCount: Int = 1,
    shipped: Boolean = false,
) = Order(id, customer, itemCount, shipped)

@Composable
fun OrderSummary(order: Order) {
    Column {
        Text(order.customer)
        Text(if (order.itemCount == 1) "1 item" else "${order.itemCount} items")
        Text(if (order.shipped) "Shipped" else "Processing")
    }
}

@RunWith(RobolectricTestRunner::class)
class OrderSummaryTest {
    @get:Rule val composeTestRule = createComposeRule()

    @Test
    fun pluralizesItemCount() {
        composeTestRule.setContent { OrderSummary(anOrder(itemCount = 3)) }

        composeTestRule.onNodeWithText("3 items").assertIsDisplayed()
    }

    @Test
    fun shippedOrder_showsShipped() {
        val processing = anOrder()
        composeTestRule.setContent { OrderSummary(processing.copy(shipped = true)) }

        composeTestRule.onNodeWithText("Shipped").assertIsDisplayed()
    }
}
```

Keep builders in the test source set (for example `src/test/kotlin/.../TestData.kt`), next to the fakes. Builders for production types should not ship in the app.

## In-Memory Fake Repositories

A fake implements the same interface as production with an in-memory map or `MutableStateFlow`. Tests seed it before rendering and can change it mid-test. Android's testing guide prefers fakes over mocks ([when-to-mock.md](../architecture/when-to-mock.md)).

```kotlin
import androidx.compose.foundation.layout.Column
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.update
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

data class Contact(val id: Long, val name: String)

interface ContactRepository {
    val contacts: Flow<List<Contact>>
    suspend fun add(name: String)
}

class FakeContactRepository(vararg initial: Contact) : ContactRepository {
    private val state = MutableStateFlow(initial.toList())
    private var nextId = (initial.maxOfOrNull { it.id } ?: 0) + 1   // deterministic IDs
    override val contacts: Flow<List<Contact>> = state

    override suspend fun add(name: String) {
        state.update { it + Contact(nextId++, name) }
    }

    // Test-only hook: push a change as if another screen made it.
    fun emit(vararg contacts: Contact) { state.value = contacts.toList() }
}

@Composable
fun ContactList(repository: ContactRepository) {
    val contacts by repository.contacts.collectAsState(initial = emptyList())
    Column {
        if (contacts.isEmpty()) Text("No contacts")
        contacts.forEach { Text(it.name) }
    }
}

@RunWith(RobolectricTestRunner::class)
class ContactListTest {
    @get:Rule val composeTestRule = createComposeRule()

    @Test
    fun showsSeededContacts() {
        val repository = FakeContactRepository(Contact(1, "Ada"), Contact(2, "Grace"))
        composeTestRule.setContent { ContactList(repository) }

        composeTestRule.onNodeWithText("Grace").assertIsDisplayed()
    }

    @Test
    fun updatesWhenRepositoryChanges() {
        val repository = FakeContactRepository()
        composeTestRule.setContent { ContactList(repository) }
        composeTestRule.onNodeWithText("No contacts").assertIsDisplayed()

        repository.emit(Contact(1, "Ada"))

        composeTestRule.onNodeWithText("Ada").assertIsDisplayed()
    }
}
```

Guidelines for fakes:

| Do | Why |
| --- | --- |
| Create a new fake in each test | No state carries over between tests |
| Seed through the constructor | Arrange is one line and visible in the test |
| Add small test hooks (`emit`, `failNext()`) | Lets the test drive error and update paths |
| Back flows with `MutableStateFlow` | The UI recomposes when the test changes it; finders sync automatically |
| Keep fakes in a shared test module when several modules use them | One fake per interface, kept in step with production |

Testing the error path with a fake that throws on demand is shown in [viewmodel-state.md](../testing-patterns/viewmodel-state.md).

## Deterministic Time and IDs

Anything derived from "now" or randomness makes text unstable. Inject the source and give tests a fixed one.

```kotlin
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

fun interface TimeSource { fun nowMillis(): Long }

class FixedTimeSource(var nowMillis: Long) : TimeSource {
    override fun nowMillis() = nowMillis
}

@Composable
fun LastSeen(lastSeenMillis: Long, time: TimeSource) {
    val minutes = (time.nowMillis() - lastSeenMillis) / 60_000
    Text(if (minutes < 1) "Online" else "Seen $minutes min ago")
}

@RunWith(RobolectricTestRunner::class)
class LastSeenTest {
    @get:Rule val composeTestRule = createComposeRule()

    @Test
    fun showsMinutesSinceLastSeen() {
        val time = FixedTimeSource(nowMillis = 10 * 60_000L)

        composeTestRule.setContent { LastSeen(lastSeenMillis = 0L, time = time) }

        composeTestRule.onNodeWithText("Seen 10 min ago").assertIsDisplayed()
    }
}
```

- If the app already uses `java.time.Clock`, pass `Clock.fixed(...)` in tests. `java.time` needs API 26, or core library desugaring when `minSdk` is lower.
- The Compose test clock (`mainClock`) controls frames, animations, and coroutine `delay` in composition, not your domain clock. See [synchronization.md](synchronization.md#the-test-clock).
- For IDs, inject a generator or use a counter in the fake (as `FakeContactRepository` does) instead of `UUID.randomUUID()`.
- Locale-dependent formatting (dates, numbers) depends on the Robolectric default locale (`en-US`) unless the test sets qualifiers; see [configuration-changes.md](../testing-patterns/configuration-changes.md).

## UI State Fixtures for Stateless Composables

When screens take a UI state object (`LoginUiState`), named fixtures for each state double as documentation and feed both preview functions and tests:

```kotlin snippet
object ProfileStates {
    val loading = ProfileUiState(isLoading = true)
    val loaded = ProfileUiState(name = "Ada Lovelace", followers = 1_815)
    val error = ProfileUiState(error = "No connection")
}
```

Put the object in a source set both the previews and the tests can see (often `main` in a `:core:testing`-style module, or `debug`), and pass each state to the stateless content composable in a test ([viewmodel-state.md](../testing-patterns/viewmodel-state.md#test-every-ui-state-on-the-stateless-content)). For many states, run one test per state with `ParameterizedRobolectricTestRunner` ([test-structure.md](test-structure.md#parameterized-tests)). `PreviewParameterProvider` lives in `ui-tooling-preview`, which a test module does not get from `ui-test-junit4`; add that dependency before reusing preview providers in tests.

## Strings and Resources

Asserting on hard-coded English is fine for most tests. When text comes from `strings.xml`, read the same resource in the test so translations and copy edits don't break it:

```kotlin snippet
val context = ApplicationProvider.getApplicationContext<Context>()
composeTestRule.onNodeWithText(context.getString(R.string.sign_in)).performClick()
```

`unitTests.isIncludeAndroidResources = true` is required for resources under Robolectric ([setup-configuration.md](setup-configuration.md)).

## Anti-Patterns

| Anti-pattern | Problem | Do instead |
| --- | --- | --- |
| One shared `val testUser` in a `companion object` mutated by tests | Order-dependent tests | Build data per test |
| Builders that require every field | Noise hides the value under test | Default arguments |
| `System.currentTimeMillis()` / `Random` / `UUID.randomUUID()` reaching the UI | Flaky text | Injected time and ID sources |
| Placeholder text like `"test"`, `"aaa"` | Collides with other nodes; unreadable failures | Distinct, realistic values |
| Copying JSON fixtures into many tests | Drift and noise | Builders; one fixture file per format if parsing is under test |
| Mocking a data class or repository just to return data | Re-states setup, brittle | A fake or a builder |

## Related References

- [when-to-mock.md](../architecture/when-to-mock.md): fakes vs mocks
- [rules-fixtures.md](rules-fixtures.md): per-test setup
- [viewmodel-state.md](../testing-patterns/viewmodel-state.md): ViewModels backed by fakes
- [screen-robots.md](screen-robots.md): reusable steps over the data
