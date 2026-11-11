# Test Structure

## Table of Contents

1. [Files and Layout](#files-and-layout)
2. [Choosing the Test Entry Point](#choosing-the-test-entry-point)
3. [createComposeRule](#createcomposerule)
4. [createAndroidComposeRule](#createandroidcomposerule)
5. [runComposeUiTest](#runcomposeuitest)
6. [setContent Once per Test](#setcontent-once-per-test)
7. [Naming and Arrange-Act-Assert](#naming-and-arrange-act-assert)
8. [Testing a Composable vs a Screen](#testing-a-composable-vs-a-screen)
9. [Parameterized Tests](#parameterized-tests)
10. [Anti-Patterns to Avoid](#anti-patterns-to-avoid)

## Files and Layout

Robolectric Compose tests are local unit tests, so they live in `src/test`, mirroring the package of the code under test:

```text
app/src/main/kotlin/com/example/login/LoginScreen.kt
app/src/test/kotlin/com/example/login/LoginScreenTest.kt
app/src/test/kotlin/com/example/login/LoginRobot.kt          # optional, see screen-robots.md
app/src/test/kotlin/com/example/testing/FakeAuthRepository.kt # shared fakes
app/src/test/resources/robolectric.properties                 # module-wide Robolectric config
```

- One test class per screen or component: `LoginScreenTest`, `PriceTagTest`.
- Split a class that grows past a few hundred lines by behavior (`LoginScreenValidationTest`, `LoginScreenSubmitTest`).
- Put fakes and builders used by several classes in a shared test package ([test-data.md](test-data.md)). Repeated interaction steps belong in a robot ([screen-robots.md](screen-robots.md)).

## Choosing the Test Entry Point

All of these come from the **v2** packages (`androidx.compose.ui.test.junit4.v2` and `androidx.compose.ui.test.v2`). The v1 versions are deprecated ([migration.md](../architecture/migration.md)).

| Entry point | Host activity | You call `setContent`? | Pick it when |
| --- | --- | --- | --- |
| `createComposeRule()` | `ComponentActivity` (from `ui-test-manifest`) | Yes | Default for composables and screens. No activity access needed |
| `createAndroidComposeRule<ComponentActivity>()` | `ComponentActivity` | Yes | You also need `activity` (string resources, `onBackPressedDispatcher`, window) |
| `createAndroidComposeRule<MainActivity>()` | Your activity, launched by the rule | **No**, the activity sets content | The test covers the real activity: its `onCreate`, intent extras, DI wiring |
| `createEmptyComposeRule()` | None; you launch one (`ActivityScenario`) | No | Content is created by code you start yourself, after the rule runs |
| `runComposeUiTest { }` | `ComponentActivity` | Yes | No JUnit rule; the body is a suspend block in a `runTest` scope sharing the Compose clock |

Activity-based variants are covered in [activities-intents.md](../testing-patterns/activities-intents.md). Shared rule setup (rule chains, Hilt) is in [rules-fixtures.md](rules-fixtures.md).

## createComposeRule

Most tests need nothing else. The rule launches a `ComponentActivity` before each test and closes it afterwards, so each test starts with fresh content.

```kotlin
import androidx.compose.foundation.layout.Row
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

@Composable
fun CartBadge(count: Int, onViewCart: () -> Unit) {
    Row {
        Text(if (count == 0) "Cart is empty" else "$count items")
        if (count > 0) TextButton(onClick = onViewCart) { Text("View cart") }
    }
}

@RunWith(RobolectricTestRunner::class)
class CartBadgeTest {
    @get:Rule
    val composeTestRule = createComposeRule()

    @Test
    fun emptyCart_showsEmptyMessage() {
        composeTestRule.setContent { CartBadge(count = 0, onViewCart = {}) }

        composeTestRule.onNodeWithText("Cart is empty").assertIsDisplayed()
        composeTestRule.onNodeWithText("View cart").assertDoesNotExist()
    }

    @Test
    fun nonEmptyCart_showsCountAndButton() {
        composeTestRule.setContent { CartBadge(count = 3, onViewCart = {}) }

        composeTestRule.onNodeWithText("3 items").assertIsDisplayed()
        composeTestRule.onNodeWithText("View cart").assertIsDisplayed()
    }
}
```

`createComposeRule` takes an optional `CoroutineContext` that is added to the context the composition's effects run in. Most tests leave it out.

## createAndroidComposeRule

Use `createAndroidComposeRule<ComponentActivity>()` when the test needs the activity, most often to read a string resource so the test does not hard-code translated text:

```kotlin
import androidx.activity.ComponentActivity
import androidx.compose.material3.Text
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithText
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

@RunWith(RobolectricTestRunner::class)
class ActivityAccessTest {
    @get:Rule
    val composeTestRule = createAndroidComposeRule<ComponentActivity>()

    @Test
    fun cancelLabel_comesFromResources() {
        val cancel = composeTestRule.activity.getString(android.R.string.cancel)
        composeTestRule.setContent { Text(cancel) }

        composeTestRule.onNodeWithText(cancel).assertIsDisplayed()
    }
}
```

With your own activity (`createAndroidComposeRule<MainActivity>()`), the activity's `onCreate` already calls `setContent`, so calling `composeTestRule.setContent` throws. The activity must be declared in a manifest the unit tests see; one defined only in `src/test` cannot be launched ([setup-configuration.md](setup-configuration.md#why-each-piece-is-there)).

## runComposeUiTest

`runComposeUiTest` replaces the rule with a function. The block's receiver is a `ComposeUiTest` with the same finders and `mainClock`, and the block is a suspend function running inside `runTest`, so the test coroutine and Compose share one virtual clock. The function is `@ExperimentalTestApi`.

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
class SplashTest {
    @Test
    fun splash_showsContentAfterDelay() = runComposeUiTest {
        setContent {
            var ready by remember { mutableStateOf(false) }
            LaunchedEffect(Unit) {
                delay(1_000)
                ready = true
            }
            Text(if (ready) "Welcome" else "Loading…")
        }
        onNodeWithText("Loading…").assertIsDisplayed()

        mainClock.advanceTimeBy(1_000)

        onNodeWithText("Welcome").assertIsDisplayed()
    }
}
```

Prefer `runComposeUiTest` over a rule when the test calls suspend functions itself (for example collecting a flow or calling a fake's `suspend` method). With a rule plus a separate `runTest { }`, there are two schedulers and advancing one does not advance the other ([synchronization.md](synchronization.md#v1-vs-v2-dispatchers)). The rule is still the usual choice when a class shares rules (Hilt, Roborazzi, `TemporaryFolder`) through `@get:Rule`.

## setContent Once per Test

Each test sets content **once**, at the start. A second `setContent` on the same rule throws:

```text
java.lang.IllegalStateException: androidx.activity.ComponentActivity@… has already set content.
```

To test how a composable reacts to new inputs, drive it from state the test owns instead of calling `setContent` again:

```kotlin
import androidx.compose.material3.Text
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

@RunWith(RobolectricTestRunner::class)
class UnreadCountTest {
    @get:Rule
    val composeTestRule = createComposeRule()

    @Test
    fun label_followsChangingCount() {
        val unread = mutableIntStateOf(1)
        composeTestRule.setContent { Text("${unread.intValue} unread") }
        composeTestRule.onNodeWithText("1 unread").assertIsDisplayed()

        unread.intValue = 5

        composeTestRule.onNodeWithText("5 unread").assertIsDisplayed()
    }
}
```

The same rule applies to `runComposeUiTest`. Setting content in a `@Before` method is fine when every test in the class renders the same thing; most screens take per-test inputs, so set content in the test.

## Naming and Arrange-Act-Assert

A test name says one behavior and its result. Kotlin backtick names with spaces are legal on the JVM, but many Android projects avoid them; `subject_condition_result` or `condition_result` reads well in Gradle reports.

| Weak | Better |
| --- | --- |
| `testLogin` | `submit_withEmptyPassword_showsPasswordError` |
| `buttonWorks` | `addToCart_disablesButtonWhileSaving` |
| `loginScreenTest3` | `rememberMe_isCheckedByDefault` |
| `validatesAndSubmitsAndNavigates` | Split into three tests |

Arrange (set content with fakes), act (`perform…`), assert (`assert…` on what the user sees, or on a fake that records calls). Blank lines separate the sections; no comments needed.

```kotlin
import androidx.compose.foundation.layout.Column
import androidx.compose.material3.Button
import androidx.compose.material3.Text
import androidx.compose.material3.TextField
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextInput
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

@Composable
fun NewsletterForm(onSubscribe: (String) -> Unit) {
    var email by remember { mutableStateOf("") }
    Column {
        TextField(value = email, onValueChange = { email = it }, label = { Text("Email") })
        Button(onClick = { onSubscribe(email) }, enabled = "@" in email) { Text("Subscribe") }
    }
}

@RunWith(RobolectricTestRunner::class)
class NewsletterFormTest {
    @get:Rule
    val composeTestRule = createComposeRule()

    @Test
    fun subscribe_isDisabledUntilEmailLooksValid() {
        composeTestRule.setContent { NewsletterForm(onSubscribe = {}) }

        composeTestRule.onNodeWithText("Email").performTextInput("ada")

        composeTestRule.onNodeWithText("Subscribe").assertIsNotEnabled()
    }

    @Test
    fun subscribe_passesTypedEmail() {
        val subscribed = mutableListOf<String>()
        composeTestRule.setContent { NewsletterForm(onSubscribe = { subscribed += it }) }

        composeTestRule.onNodeWithText("Email").performTextInput("ada@example.com")
        composeTestRule.onNodeWithText("Subscribe").performClick()

        assertEquals(listOf("ada@example.com"), subscribed)
        composeTestRule.onNodeWithText("ada@example.com").assertIsDisplayed()
    }
}
```

- **One behavior per test.** If the name needs "and", split it. Several assertions about the same outcome (the button text and its enabled state after one action) are fine.
- **Assert what the user sees** or what a collaborator received, not internal state ([assertions.md](assertions.md)).
- **No conditionals in tests.** A test with `if` tests two behaviors; write two tests or a parameterized one.

## Testing a Composable vs a Screen

| Level | Inputs | Outputs to assert | Typical setup |
| --- | --- | --- | --- |
| Stateless composable (`PriceTag`, `LoginForm(state, onSubmit)`) | Parameters | Rendered nodes; lambda calls recorded in a list | `setContent { Composable(args) }` |
| Stateful composable (internal `remember`) | User actions | Rendered nodes after actions | Same, then `perform…` |
| Screen with a ViewModel | A ViewModel built over fakes | Rendered nodes; calls the fakes recorded | Construct the ViewModel in the test and pass it in ([viewmodel-state.md](../testing-patterns/viewmodel-state.md)) |
| Flow across screens | Navigation host + fakes | Current destination's content | [navigation.md](../testing-patterns/navigation.md) |
| Activity | Intent, real `onCreate` | Content the activity sets | `createAndroidComposeRule<MainActivity>()` ([activities-intents.md](../testing-patterns/activities-intents.md)) |

Most UI tests should target a screen's stateless content composable (`LoginContent(state, onEvent)`) and a smaller number should run the full screen with its ViewModel. The stateless level is fast and needs no fakes; the screen level checks the wiring. Hoisting state out of composables is what makes the first level possible.

## Parameterized Tests

`ParameterizedRobolectricTestRunner` runs a class once per data row, under Robolectric. Rows come from a `@JvmStatic` function annotated with `@ParameterizedRobolectricTestRunner.Parameters`, and are passed to the constructor. `name` formats the row in reports (`{0}`, `{1}` are the row's values, `{index}` its position).

```kotlin
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.ParameterizedRobolectricTestRunner

@Composable
fun PasswordStrength(password: String) {
    val label = when {
        password.length < 8 -> "Too short"
        password.any(Char::isDigit) && password.any(Char::isUpperCase) -> "Strong"
        else -> "Weak"
    }
    Text(label)
}

@RunWith(ParameterizedRobolectricTestRunner::class)
class PasswordStrengthTest(private val password: String, private val expected: String) {
    @get:Rule
    val composeTestRule = createComposeRule()

    @Test
    fun showsStrengthLabel() {
        composeTestRule.setContent { PasswordStrength(password) }

        composeTestRule.onNodeWithText(expected).assertIsDisplayed()
    }

    companion object {
        @JvmStatic
        @ParameterizedRobolectricTestRunner.Parameters(name = "{0} -> {1}")
        fun data(): List<Array<Any>> = listOf(
            arrayOf("abc", "Too short"),
            arrayOf("abcdefgh", "Weak"),
            arrayOf("Abcdefg1", "Strong"),
        )
    }
}
```

- The whole class is parameterized, so keep non-parameterized tests in a separate class.
- Each row starts a fresh Robolectric environment and activity, so rows cost about as much as separate tests. Keep the table to cases that exercise different branches.
- For a couple of cases, two plainly named tests read better than a table.

## Anti-Patterns to Avoid

| Anti-Pattern | Problem | Solution |
| --- | --- | --- |
| Importing `androidx.compose.ui.test.junit4.createComposeRule` | Deprecated v1, different dispatcher | The `junit4.v2` import |
| Calling `setContent` twice in one test | `IllegalStateException: … has already set content` | Set content once; drive changes through state the test owns |
| `setContent` on `createAndroidComposeRule<MainActivity>()` | The activity already set content | Use `ComponentActivity`, or test the activity as is |
| A test-only Activity class in `src/test` | Not in the manifest, cannot launch | `ComponentActivity` + `setContent` |
| `createComposeRule()` plus `runTest { }` with `advanceTimeBy` | Two clocks; `advanceTimeBy` does not move Compose | `runComposeUiTest`, or `composeTestRule.mainClock` |
| One test covering validation, submit, and navigation | First failure hides the rest; vague name | One behavior per test |
| Testing every screen only through the Activity | Slow, needs the whole DI graph | Test stateless content directly; a few screen/activity tests for wiring |
| Copy-pasted tests differing only in input | Drift and noise | `ParameterizedRobolectricTestRunner` |

## Related References

- **Gradle setup and `@Config`**: [setup-configuration.md](setup-configuration.md)
- **Finding nodes**: [finders-semantics.md](finders-semantics.md)
- **Assertions**: [assertions.md](assertions.md)
- **Clocks and waiting**: [synchronization.md](synchronization.md)
- **Rules and fixtures**: [rules-fixtures.md](rules-fixtures.md)
- **Robots for repeated steps**: [screen-robots.md](screen-robots.md)
- **Fakes and builders**: [test-data.md](test-data.md)
