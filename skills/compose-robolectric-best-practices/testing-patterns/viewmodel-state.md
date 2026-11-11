# Screens Backed by a ViewModel

## Table of Contents

1. [Split the Screen: Stateful Route, Stateless Content](#split-the-screen-stateful-route-stateless-content)
2. [Test Every UI State on the Stateless Content](#test-every-ui-state-on-the-stateless-content)
3. [Test the Stateful Screen with a Real ViewModel on Fakes](#test-the-stateful-screen-with-a-real-viewmodel-on-fakes)
4. [Dispatchers.Main Under Robolectric](#dispatchersmain-under-robolectric)
5. [collectAsStateWithLifecycle](#collectasstatewithlifecycle)
6. [One-Off Events](#one-off-events)
7. [ViewModel Tests Without Compose](#viewmodel-tests-without-compose)
8. [Anti-Patterns](#anti-patterns)

## Split the Screen: Stateful Route, Stateless Content

State hoisting gives each layer a test that fits it:

| Layer | Holds | Test with |
| --- | --- | --- |
| `ProfileViewModel` | Loading logic, `StateFlow<ProfileUiState>` | Plain JUnit + `kotlinx-coroutines-test` + Turbine ([below](#viewmodel-tests-without-compose)) |
| `ProfileRoute(viewModel)` | Collects state, wires callbacks | A few Robolectric tests with the real ViewModel on fake repositories |
| `ProfileScreen(state, onRetry)` | Pure UI for a given state | Many Robolectric tests, one per state, no ViewModel |

Most UI coverage belongs on the stateless screen: no coroutines, no fakes, each state set directly. The route gets a handful of tests that prove the wiring.

## Test Every UI State on the Stateless Content

```kotlin
import androidx.compose.foundation.layout.Column
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import com.google.common.truth.Truth.assertThat
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

sealed interface ProfileUiState {
    data object Loading : ProfileUiState
    data class Content(val name: String) : ProfileUiState
    data class Error(val message: String) : ProfileUiState
}

@Composable
fun ProfileScreen(state: ProfileUiState, onRetry: () -> Unit) {
    when (state) {
        ProfileUiState.Loading ->
            CircularProgressIndicator(Modifier.semantics { contentDescription = "Loading profile" })
        is ProfileUiState.Content -> Text("Hello, ${state.name}")
        is ProfileUiState.Error -> Column {
            Text(state.message)
            Button(onClick = onRetry) { Text("Retry") }
        }
    }
}

@RunWith(RobolectricTestRunner::class)
class ProfileScreenTest {
    @get:Rule val composeTestRule = createComposeRule()

    @Test
    fun loading() {
        composeTestRule.setContent { ProfileScreen(ProfileUiState.Loading, onRetry = {}) }

        composeTestRule.onNodeWithContentDescription("Loading profile").assertIsDisplayed()
    }

    @Test
    fun content() {
        composeTestRule.setContent { ProfileScreen(ProfileUiState.Content("Ada"), onRetry = {}) }

        composeTestRule.onNodeWithText("Hello, Ada").assertIsDisplayed()
        composeTestRule.onNodeWithContentDescription("Loading profile").assertDoesNotExist()
    }

    @Test
    fun errorOffersRetry() {
        var retries = 0
        composeTestRule.setContent {
            ProfileScreen(ProfileUiState.Error("No connection"), onRetry = { retries++ })
        }

        composeTestRule.onNodeWithText("No connection").assertIsDisplayed()
        composeTestRule.onNodeWithText("Retry").performClick()

        assertThat(retries).isEqualTo(1)
    }
}
```

An indeterminate `CircularProgressIndicator` is an infinite animation; the Compose test framework does not wait for it, so the loading test does not hang. See [animations-clock.md](animations-clock.md).

## Test the Stateful Screen with a Real ViewModel on Fakes

Build the real ViewModel with a fake repository the test controls. A fake that suspends until the test releases it lets the test observe the loading state, then the result. See [when-to-mock.md](../architecture/when-to-mock.md) for fakes versus mocks.

```kotlin
import androidx.compose.foundation.layout.Column
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import com.google.common.truth.Truth.assertThat
import java.io.IOException
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

sealed interface ProfileUiState {
    data object Loading : ProfileUiState
    data class Content(val name: String) : ProfileUiState
    data class Error(val message: String) : ProfileUiState
}

interface ProfileRepository {
    suspend fun loadName(): String
}

class FakeProfileRepository : ProfileRepository {
    private val responses = Channel<Result<String>>(Channel.UNLIMITED)
    var calls = 0
        private set

    override suspend fun loadName(): String {
        calls++
        return responses.receive().getOrThrow()
    }

    fun succeed(name: String) = responses.trySend(Result.success(name))
    fun fail(message: String) = responses.trySend(Result.failure(IOException(message)))
}

class ProfileViewModel(private val repository: ProfileRepository) : ViewModel() {
    private val _state = MutableStateFlow<ProfileUiState>(ProfileUiState.Loading)
    val state: StateFlow<ProfileUiState> = _state.asStateFlow()

    init { load() }

    fun retry() = load()

    private fun load() {
        _state.value = ProfileUiState.Loading
        viewModelScope.launch {
            _state.value = try {
                ProfileUiState.Content(repository.loadName())
            } catch (e: IOException) {
                ProfileUiState.Error(e.message ?: "Something went wrong")
            }
        }
    }
}

@Composable
fun ProfileRoute(viewModel: ProfileViewModel) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    ProfileScreen(state, onRetry = viewModel::retry)
}

@Composable
fun ProfileScreen(state: ProfileUiState, onRetry: () -> Unit) {
    when (state) {
        ProfileUiState.Loading ->
            CircularProgressIndicator(Modifier.semantics { contentDescription = "Loading profile" })
        is ProfileUiState.Content -> Text("Hello, ${state.name}")
        is ProfileUiState.Error -> Column {
            Text(state.message)
            Button(onClick = onRetry) { Text("Retry") }
        }
    }
}

@RunWith(RobolectricTestRunner::class)
class ProfileRouteTest {
    @get:Rule val composeTestRule = createComposeRule()

    private val repository = FakeProfileRepository()

    @Test
    fun showsLoadingThenTheProfile() {
        composeTestRule.setContent { ProfileRoute(ProfileViewModel(repository)) }
        composeTestRule.onNodeWithContentDescription("Loading profile").assertIsDisplayed()

        repository.succeed("Ada")

        composeTestRule.onNodeWithText("Hello, Ada").assertIsDisplayed()
    }

    @Test
    fun retryAfterAnErrorLoadsAgain() {
        composeTestRule.setContent { ProfileRoute(ProfileViewModel(repository)) }
        repository.fail("No connection")
        composeTestRule.onNodeWithText("No connection").assertIsDisplayed()

        composeTestRule.onNodeWithText("Retry").performClick()
        repository.succeed("Ada")

        composeTestRule.onNodeWithText("Hello, Ada").assertIsDisplayed()
        assertThat(repository.calls).isEqualTo(2)
    }
}
```

Create the ViewModel directly and pass it in. Calling `viewModel()` inside `setContent` also works (the test activity is a `ViewModelStoreOwner`), but then the test needs a factory to inject fakes, and the instance is harder to reach. Hilt-based apps follow the same shape with test bindings; see [rules-fixtures.md](../core/rules-fixtures.md).

**A fake that returns immediately hides the loading state.** Under Robolectric the test runs on the main thread, and `viewModelScope` uses `Dispatchers.Main.immediate`, so a `launch` in `init` runs straight away. With the pinned stack a ViewModel whose fake answered without suspending had already reached its final state before `setContent` returned. That is fine for tests about the result; use a suspending fake (as above) to test what the user sees while waiting.

## Dispatchers.Main Under Robolectric

`Dispatchers.Main` under Robolectric is the Android main looper. The Compose test rule idles that looper, so work posted to it runs before the next finder. Delayed work is different:

| ViewModel does | What happens in a Compose test (pinned stack) | Fix |
| --- | --- | --- |
| `launch { repository.load() }` with a fake | Runs; finders see the result | Nothing |
| `delay(1_000)` in `viewModelScope` | Never finishes: `mainClock.advanceTimeBy` and `waitUntil` don't advance the looper's clock | Share the Compose clock's scheduler (below), or `shadowOf(Looper.getMainLooper()).idleFor(...)` |
| Test calls `Dispatchers.setMain(StandardTestDispatcher())` | ViewModel coroutines queue on a scheduler nothing advances; the screen stays on Loading | Pass `composeTestRule.mainClock.scheduler` to the dispatcher |

Sharing the scheduler puts ViewModel coroutines on the same virtual clock as composition, so `mainClock.advanceTimeBy` drives debounces, timeouts, and polling in the ViewModel.

```kotlin
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.test.assertIsDisplayed
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
import org.junit.After
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

class SessionViewModel : ViewModel() {
    private val _message = MutableStateFlow("Signed in")
    val message: StateFlow<String> = _message

    init {
        viewModelScope.launch {
            delay(5 * 60_000L)
            _message.value = "Session expired"
        }
    }
}

@Composable
fun SessionBanner(viewModel: SessionViewModel) {
    val message by viewModel.message.collectAsStateWithLifecycle()
    Text(message)
}

@OptIn(ExperimentalCoroutinesApi::class)
@RunWith(RobolectricTestRunner::class)
class SessionBannerTest {
    @get:Rule val composeTestRule = createComposeRule()

    @Before
    fun shareTheComposeClock() {
        Dispatchers.setMain(StandardTestDispatcher(composeTestRule.mainClock.scheduler))
    }

    @After
    fun restoreMain() {
        Dispatchers.resetMain()
    }

    @Test
    fun sessionExpiresAfterFiveMinutes() {
        composeTestRule.setContent { SessionBanner(SessionViewModel()) }
        composeTestRule.onNodeWithText("Signed in").assertIsDisplayed()

        composeTestRule.mainClock.advanceTimeBy(5 * 60_000L)

        composeTestRule.onNodeWithText("Session expired").assertIsDisplayed()
    }
}
```

Two side effects of sharing: work launched in `init` is now queued instead of immediate, so the first frame shows the initial state; and the ViewModel must be created after `setMain` (inside the test or `setContent`, not in a field initializer). An injected `CoroutineDispatcher` or time source is the alternative when the ViewModel already takes one; see [synchronization.md](../core/synchronization.md) for the test clock.

## collectAsStateWithLifecycle

`collectAsStateWithLifecycle` collects only while the `LocalLifecycleOwner` is at least `STARTED`. The activity behind `createComposeRule()` is resumed, so collection runs in ordinary tests. Prefer it over `collectAsState` in screens: it stops upstream work in the background, and tests don't need anything extra. To test what happens when the app goes to the background, drive the activity's lifecycle with `createAndroidComposeRule` and its `ActivityScenario` (see [activities-intents.md](activities-intents.md)).

## One-Off Events

The Android architecture guidance recommends modelling UI events as state: the ViewModel exposes "show this message" in its `UiState`, the UI shows it, then tells the ViewModel it was shown. A test can then assert the visible result. Navigation after a success is a callback the screen invokes once.

```kotlin
import androidx.compose.material3.Button
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import com.google.common.truth.Truth.assertThat
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

data class EditUiState(val userMessage: String? = null, val saved: Boolean = false)

fun interface NoteSaver {
    suspend fun save(): Boolean
}

class EditNoteViewModel(private val saver: NoteSaver) : ViewModel() {
    private val _state = MutableStateFlow(EditUiState())
    val state: StateFlow<EditUiState> = _state

    fun save() {
        viewModelScope.launch {
            if (saver.save()) _state.update { it.copy(saved = true) }
            else _state.update { it.copy(userMessage = "Couldn't save. Try again.") }
        }
    }

    fun userMessageShown() = _state.update { it.copy(userMessage = null) }
}

@Composable
fun EditNoteRoute(viewModel: EditNoteViewModel, onSaved: () -> Unit) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    val snackbarHostState = remember { SnackbarHostState() }
    state.userMessage?.let { message ->
        LaunchedEffect(message) {
            snackbarHostState.showSnackbar(message)
            viewModel.userMessageShown()
        }
    }
    LaunchedEffect(state.saved) { if (state.saved) onSaved() }
    Scaffold(snackbarHost = { SnackbarHost(snackbarHostState) }) { padding ->
        Button(onClick = viewModel::save, modifier = Modifier.padding(padding)) { Text("Save") }
    }
}

@RunWith(RobolectricTestRunner::class)
class EditNoteRouteTest {
    @get:Rule val composeTestRule = createComposeRule()

    @Test
    fun failedSaveShowsAMessage() {
        val viewModel = EditNoteViewModel(saver = { false })
        composeTestRule.setContent { EditNoteRoute(viewModel, onSaved = {}) }

        composeTestRule.onNodeWithText("Save").performClick()

        composeTestRule.onNodeWithText("Couldn't save. Try again.").assertIsDisplayed()
    }

    @Test
    fun successfulSaveNavigatesOnce() {
        var navigations = 0
        val viewModel = EditNoteViewModel(saver = { true })
        composeTestRule.setContent { EditNoteRoute(viewModel, onSaved = { navigations++ }) }

        composeTestRule.onNodeWithText("Save").performClick()

        composeTestRule.runOnIdle { assertThat(navigations).isEqualTo(1) }
    }
}
```

If a codebase uses a `Channel` or `SharedFlow` for events instead, test it the same way: trigger the action, then assert the visible outcome or the callback. Avoid asserting on the flow from the UI test; that belongs in the ViewModel test.

## ViewModel Tests Without Compose

ViewModel logic needs no Robolectric and no UI. Replace `Dispatchers.Main` with a test dispatcher through a rule, and read the `StateFlow` with Turbine. `runTest` reuses the scheduler of a `TestDispatcher` installed as Main.

```kotlin
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.cash.turbine.test
import com.google.common.truth.Truth.assertThat
import java.io.IOException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.TestDispatcher
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TestWatcher
import org.junit.runner.Description

@OptIn(ExperimentalCoroutinesApi::class)
class MainDispatcherRule(
    private val dispatcher: TestDispatcher = UnconfinedTestDispatcher(),
) : TestWatcher() {
    override fun starting(description: Description) = Dispatchers.setMain(dispatcher)
    override fun finished(description: Description) = Dispatchers.resetMain()
}

sealed interface ProfileUiState {
    data object Loading : ProfileUiState
    data class Content(val name: String) : ProfileUiState
    data class Error(val message: String) : ProfileUiState
}

class FakeProfileRepository {
    private val responses = Channel<Result<String>>(Channel.UNLIMITED)
    suspend fun loadName(): String = responses.receive().getOrThrow()
    fun succeed(name: String) = responses.trySend(Result.success(name))
    fun fail(message: String) = responses.trySend(Result.failure(IOException(message)))
}

class ProfileViewModel(private val repository: FakeProfileRepository) : ViewModel() {
    private val _state = MutableStateFlow<ProfileUiState>(ProfileUiState.Loading)
    val state: StateFlow<ProfileUiState> = _state.asStateFlow()

    init {
        viewModelScope.launch {
            _state.value = try {
                ProfileUiState.Content(repository.loadName())
            } catch (e: IOException) {
                ProfileUiState.Error(e.message ?: "Something went wrong")
            }
        }
    }
}

class ProfileViewModelTest {
    @get:Rule val mainDispatcherRule = MainDispatcherRule()

    @Test
    fun emitsLoadingThenContent() = runTest {
        val repository = FakeProfileRepository()
        val viewModel = ProfileViewModel(repository)

        viewModel.state.test {
            assertThat(awaitItem()).isEqualTo(ProfileUiState.Loading)
            repository.succeed("Ada")
            assertThat(awaitItem()).isEqualTo(ProfileUiState.Content("Ada"))
        }
    }

    @Test
    fun emitsAnErrorWhenLoadingFails() = runTest {
        val repository = FakeProfileRepository()
        val viewModel = ProfileViewModel(repository)

        repository.fail("No connection")

        assertThat(viewModel.state.value).isEqualTo(ProfileUiState.Error("No connection"))
    }
}
```

This test class has no `@RunWith(RobolectricTestRunner::class)`: a ViewModel with injected dependencies runs on the plain JVM, which is much faster. Keep Robolectric for tests that render.

## Anti-Patterns

| Anti-Pattern | Problem | Solution |
| --- | --- | --- |
| Every state tested through the ViewModel | Slow, needs fakes for each state | Stateless screen tests for states; few route tests for wiring |
| Mocked ViewModel (`mock<ProfileViewModel>()`) | Final classes, stubbed flows, tests the mock | Real ViewModel on fake repositories |
| A fake that returns instantly in a "shows loading" test | Loading is never on screen under Robolectric | A suspending fake the test releases |
| `Dispatchers.setMain(StandardTestDispatcher())` in a Compose test | Nothing advances that scheduler; UI stuck | `StandardTestDispatcher(composeTestRule.mainClock.scheduler)` |
| `delay` in the ViewModel and `Thread.sleep` in the test | Real time doesn't move the looper's clock | Share the Compose scheduler or inject time |
| Asserting `viewModel.state.value` in a UI test | Skips the rendering the test exists for | Assert what the screen shows |
| Robolectric runner on pure ViewModel tests | Startup cost with no benefit | Plain JUnit with `MainDispatcherRule` |
| `collectAsState` in lifecycle-aware screens | Keeps collecting in the background | `collectAsStateWithLifecycle` |

## Related References

- **Idling, `waitUntil`, and the test clock**: [synchronization.md](../core/synchronization.md)
- **Fakes and test data builders**: [test-data.md](../core/test-data.md), [when-to-mock.md](../architecture/when-to-mock.md)
- **Rules for dispatchers and DI**: [rules-fixtures.md](../core/rules-fixtures.md)
- **Forms whose state lives in a ViewModel**: [forms-text-input.md](forms-text-input.md)
- **Lifecycle and activities**: [activities-intents.md](activities-intents.md)
