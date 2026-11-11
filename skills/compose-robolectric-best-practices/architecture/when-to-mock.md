# When to Mock

## Table of Contents

1. [Decision Guide](#decision-guide)
2. [Kinds of Test Doubles](#kinds-of-test-doubles)
3. [Prefer State and Lambdas over Doubles](#prefer-state-and-lambdas-over-doubles)
4. [Fake the ViewModel's Dependencies, Not the ViewModel](#fake-the-viewmodels-dependencies-not-the-viewmodel)
5. [Fakes at the Network Boundary](#fakes-at-the-network-boundary)
6. [Never Mock](#never-mock)
7. [When a Mock Library Is Reasonable](#when-a-mock-library-is-reasonable)
8. [Keeping Fakes Honest](#keeping-fakes-honest)
9. [Anti-Patterns](#anti-patterns)
10. [Related References](#related-references)

## Decision Guide

Android's guide to test doubles says fakes "don't require a mocking framework and are lightweight. They are preferred." For Compose UI tests that holds even more strongly, because the UI reacts to *state over time*, which a fake models naturally and a stub doesn't.

```
Is it the composable under test, or Compose itself?
└─ Yes → never replace it.

Can the composable take plain state and lambdas?
└─ Yes → pass values and record callbacks; no double needed.

Does the screen own a ViewModel?
└─ Use the real ViewModel, built on fake repositories/use cases.

Is the dependency at a process boundary?
├─ Network API          → fake implementation of your API interface
├─ Database / DataStore → in-memory fake repository (or the real in-memory DB)
├─ Time, IDs, random    → injected fixed sources (core/test-data.md)
├─ Android framework    → Robolectric's real-ish framework and shadows
└─ Third-party SDK      → fake of your thin wrapper around it

Do you only need to know a call happened?
└─ Record it in the fake or the lambda; assert the visible result if there is one.
```

## Kinds of Test Doubles

These are the definitions Android's testing docs use:

| Double | What it is | In Compose tests |
| --- | --- | --- |
| Fake | A working, simplified implementation (in-memory database) | Default choice for repositories and services |
| Stub | Returns programmed values, no expectations | Rarely needed; a fake or a value does the job |
| Mock | Programmed behavior plus expectations about calls | Third-party types you can't wrap; interaction-only contracts |
| Dummy | Passed but unused (an empty click lambda) | `onBack = {}` |
| Spy | Wraps a real object and records calls | Usually avoided |
| Shadow | Robolectric's fake of an Android framework class | Supplied by Robolectric; configure with `shadowOf(...)` |

## Prefer State and Lambdas over Doubles

A stateless composable is the easiest thing to test: pass state, record events. No framework, no fake class:

```kotlin
import androidx.compose.foundation.layout.Column
import androidx.compose.material3.Button
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import com.google.common.truth.Truth.assertThat
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

@Composable
fun RetryPanel(message: String, onRetry: () -> Unit) {
    Column {
        Text(message)
        Button(onClick = onRetry) { Text("Retry") }
    }
}

@RunWith(RobolectricTestRunner::class)
class RetryPanelTest {
    @get:Rule val composeTestRule = createComposeRule()

    @Test
    fun retry_invokesCallbackOnce() {
        var retries = 0
        composeTestRule.setContent { RetryPanel("No connection", onRetry = { retries++ }) }

        composeTestRule.onNodeWithText("Retry").performClick()

        assertThat(retries).isEqualTo(1)
    }
}
```

A counter or a `mutableListOf<Event>()` is a complete "mock" for a callback. This is why the stateful-route / stateless-content split ([viewmodel-state.md](../testing-patterns/viewmodel-state.md#split-the-screen-stateful-route-stateless-content)) pays off: most UI tests need no doubles at all.

## Fake the ViewModel's Dependencies, Not the ViewModel

When a test covers the stateful screen, use the **real ViewModel** with fake dependencies. Then the test covers loading, error mapping, and state transitions, which is where bugs live. Replacing the ViewModel itself (a subclass, an interface just for tests, or a mock) tests only the composable, and the stateless-content test already does that more cheaply.

```kotlin
import androidx.compose.material3.Button
import androidx.compose.material3.Text
import androidx.compose.foundation.layout.Column
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import java.io.IOException
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

interface QuoteApi { suspend fun quoteOfTheDay(): String }

class FakeQuoteApi(private val quotes: MutableList<Result<String>>) : QuoteApi {
    override suspend fun quoteOfTheDay(): String = quotes.removeAt(0).getOrThrow()
}

class QuoteViewModel(private val api: QuoteApi) : ViewModel() {
    private val _text = MutableStateFlow("Loading")
    val text: StateFlow<String> = _text

    init { refresh() }

    fun refresh() {
        viewModelScope.launch {
            _text.value = try { api.quoteOfTheDay() } catch (e: IOException) { "Offline: ${e.message}" }
        }
    }
}

@Composable
fun QuoteScreen(viewModel: QuoteViewModel) {
    val text by viewModel.text.collectAsStateWithLifecycle()
    Column {
        Text(text)
        Button(onClick = viewModel::refresh) { Text("Refresh") }
    }
}

@RunWith(RobolectricTestRunner::class)
class QuoteScreenTest {
    @get:Rule val composeTestRule = createComposeRule()

    @Test
    fun networkError_showsOffline_thenRecoversOnRefresh() {
        val api = FakeQuoteApi(mutableListOf(Result.failure(IOException("timeout")), Result.success("Stay hungry")))
        val viewModel = QuoteViewModel(api)
        composeTestRule.setContent { QuoteScreen(viewModel) }
        composeTestRule.onNodeWithText("Offline: timeout").assertIsDisplayed()

        composeTestRule.onNodeWithText("Refresh").performClick()

        composeTestRule.onNodeWithText("Stay hungry").assertIsDisplayed()
    }
}
```

The fake throws exactly the exception type production code catches, so the error branch is real. Timing concerns for ViewModels (delays, `Dispatchers.Main`) are in [viewmodel-state.md](../testing-patterns/viewmodel-state.md#dispatchersmain-under-robolectric).

## Fakes at the Network Boundary

Put an interface you own (`QuoteApi`) between the app and the HTTP client, and fake that interface in UI tests. UI tests then never parse JSON or open sockets, and they control latency and errors precisely.

Test the real HTTP implementation separately, in a plain JVM test against a local fake server (OkHttp's `MockWebServer` is a common choice, but it is not part of this skill's verified stack). Keep UI tests and HTTP-contract tests apart: a UI test that fails because of a JSON field name is testing the wrong layer.

| Layer | Double |
| --- | --- |
| Composable | None: state and lambdas |
| Screen with ViewModel | Fake repository / API interface |
| Repository | Fake API interface, or the real one against a local server |
| HTTP client adapter | Local fake server |

## Never Mock

| Don't mock | Why | Instead |
| --- | --- | --- |
| The composable under test | Then nothing real is tested | Render it with `setContent` |
| Compose runtime types (`State`, `Modifier`, `CompositionLocal`, `NavController` internals) | Compose relies on their real behavior; mocks break recomposition | Real instances; provide values with `CompositionLocalProvider` |
| `Context`, `Resources`, `Activity` | Robolectric provides real-behaving ones | `ApplicationProvider.getApplicationContext()` |
| Data classes and UI state | They are values | Builders ([test-data.md](../core/test-data.md)) |
| `Flow`/`StateFlow` | Stubbed flows don't emit over time | `MutableStateFlow` in a fake |
| Your own pure functions | Re-states the implementation | Call them for real |
| Navigation | Mocked controllers miss back stack behavior | `TestNavHostController` or a real back stack ([navigation.md](../testing-patterns/navigation.md)) |

## When a Mock Library Is Reasonable

Mockito and MockK are not part of this skill's verified harness, so no compiled examples here. A mock is a reasonable choice when:

- A third-party type is final or huge, you don't own it, and wrapping it is not worth it yet.
- The contract is *only* an interaction with no visible result (an analytics call), and a recording fake would be more code than the mock.

Even then, prefer a tiny recording fake of your own wrapper interface:

```kotlin snippet
class RecordingAnalytics : Analytics {
    val events = mutableListOf<String>()
    override fun log(event: String) { events += event }
}
// assertThat(analytics.events).containsExactly("checkout_started")
```

## Keeping Fakes Honest

A fake that drifts from production makes tests pass while the app fails.

- **Implement the production interface.** The compiler then catches signature changes.
- **Share one fake per interface** in a test-fixtures module, instead of ad-hoc fakes per test file.
- **Run a contract test against both** the fake and the real implementation for behavior both must share (ordering, errors on missing IDs).
- **Model real failure modes**: the same exception types, empty results, slow responses (`delay` in the fake, driven by the test clock; see [synchronization.md](../core/synchronization.md#the-test-clock)).

## Anti-Patterns

| Anti-pattern | Problem | Do instead |
| --- | --- | --- |
| Mocking the ViewModel to test the screen | Skips the logic that breaks | Real ViewModel on fakes, or test the stateless content |
| `verify(repository).load()` as the only assertion | Passes even if the UI shows nothing | Assert what the user sees |
| Stubbing `Flow` to return `flowOf(x)` | No updates over time | `MutableStateFlow` fake |
| A fake per test file | Duplication and drift | One shared fake per interface |
| UI tests hitting a real or staging server | Slow, flaky, nondeterministic | Fake the API interface |
| Mocking Android framework classes under Robolectric | Fights Robolectric; brittle | Real framework with shadows |

## Related References

- [test-data.md](../core/test-data.md): builders and in-memory fakes
- [viewmodel-state.md](../testing-patterns/viewmodel-state.md): ViewModels in Compose tests
- [test-architecture.md](test-architecture.md): which layer to test in
- [navigation.md](../testing-patterns/navigation.md): real navigation in tests
