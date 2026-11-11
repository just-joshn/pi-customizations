# Screen Robots

## Table of Contents

1. [What a Robot Is](#what-a-robot-is)
2. [A Basic Robot](#a-basic-robot)
3. [DSL-Style Robots](#dsl-style-robots)
4. [Robots That Span Screens](#robots-that-span-screens)
5. [Design Rules](#design-rules)
6. [When Not to Use a Robot](#when-not-to-use-a-robot)
7. [Robots vs Helpers vs Rules](#robots-vs-helpers-vs-rules)
8. [Anti-Patterns](#anti-patterns)
9. [Related References](#related-references)

## What a Robot Is

A screen robot is the Compose test equivalent of a page object: a class that knows **how** to find and drive one screen and exposes **what** the user does (`enterEmail`, `submit`) and sees (`assertErrorShown`). Tests read as user intent; when the UI changes, only the robot changes.

Take a `SemanticsNodeInteractionsProvider` rather than a specific rule type. Both `ComposeTestRule` (from `createComposeRule()`) and the `ComposeUiTest` receiver of `runComposeUiTest` implement it, so one robot works with either entry point.

## A Basic Robot

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
import androidx.compose.ui.test.SemanticsNodeInteractionsProvider
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextInput
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

@Composable
fun LoginScreen(onLogin: (String) -> Unit) {
    var email by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var error by remember { mutableStateOf<String?>(null) }
    Column {
        TextField(email, { email = it }, label = { Text("Email") })
        TextField(password, { password = it }, label = { Text("Password") })
        error?.let { Text(it) }
        Button(
            onClick = { if (password.length < 8) error = "Password too short" else onLogin(email) },
            enabled = email.isNotBlank(),
        ) { Text("Sign in") }
    }
}

class LoginRobot(private val provider: SemanticsNodeInteractionsProvider) {
    fun enterEmail(email: String) = apply { provider.onNodeWithText("Email").performTextInput(email) }
    fun enterPassword(password: String) = apply { provider.onNodeWithText("Password").performTextInput(password) }
    fun submit() = apply { provider.onNodeWithText("Sign in").performClick() }

    fun assertSignInDisabled() = apply { provider.onNodeWithText("Sign in").assertIsNotEnabled() }
    fun assertError(message: String) = apply { provider.onNodeWithText(message).assertIsDisplayed() }
}

@RunWith(RobolectricTestRunner::class)
class LoginScreenTest {
    @get:Rule val composeTestRule = createComposeRule()
    private val login = LoginRobot(composeTestRule)

    @Test
    fun signInDisabledUntilEmailEntered() {
        composeTestRule.setContent { LoginScreen(onLogin = {}) }

        login.assertSignInDisabled()
    }

    @Test
    fun shortPassword_showsError() {
        composeTestRule.setContent { LoginScreen(onLogin = {}) }

        login.enterEmail("ada@example.com")
            .enterPassword("short")
            .submit()
            .assertError("Password too short")
    }
}
```

Notes:

- The robot does not call `setContent`. The test owns what is rendered and with which fakes, so the arrange step stays visible.
- Finders inside the robot follow the same priority as anywhere else: text, content description, role, then `testTag` ([finders-semantics.md](finders-semantics.md)).
- Assertions in the robot are named after what the user sees (`assertError`), not after nodes (`assertTextNodeExists`).
- Returning `apply { }` allows chaining; returning `Unit` is fine too. Pick one per codebase.

## DSL-Style Robots

A function that takes `Robot.() -> Unit` lets tests read as a script, which suits longer flows. The same robot class works; only the entry point changes. This example also uses `runComposeUiTest`, whose receiver is the provider:

```kotlin
import androidx.compose.foundation.layout.Column
import androidx.compose.material3.Button
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.test.ExperimentalTestApi
import androidx.compose.ui.test.SemanticsNodeInteractionsProvider
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.v2.runComposeUiTest
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

@Composable
fun CartScreen() {
    var quantity by remember { mutableIntStateOf(1) }
    Column {
        Text("Quantity: $quantity")
        IconButton(onClick = { quantity++ }) { Icon(Icons.Filled.Add, contentDescription = "Increase quantity") }
        Button(onClick = { quantity = 0 }) { Text("Empty cart") }
    }
}

class CartRobot(private val provider: SemanticsNodeInteractionsProvider) {
    fun increase(times: Int = 1) = repeat(times) {
        provider.onNodeWithContentDescription("Increase quantity").performClick()
    }
    fun emptyCart() { provider.onNodeWithText("Empty cart").performClick() }
    fun quantityIs(expected: Int) { provider.onNodeWithText("Quantity: $expected").assertIsDisplayed() }
}

fun SemanticsNodeInteractionsProvider.cart(block: CartRobot.() -> Unit) = CartRobot(this).block()

@OptIn(ExperimentalTestApi::class)
@RunWith(RobolectricTestRunner::class)
class CartScreenTest {
    @Test
    fun increaseThenEmpty() = runComposeUiTest {
        setContent { CartScreen() }

        cart {
            increase(times = 2)
            quantityIs(3)
            emptyCart()
            quantityIs(0)
        }
    }
}
```

A common variant splits each step into an action block and a verification block (`cart { increase() } verify { quantityIs(2) }`). That adds a second class per screen; use it only if the team finds the split clearer.

## Robots That Span Screens

When an action navigates, return the next screen's robot. The test then can't call a login step while it is on the home screen:

```kotlin snippet
class LoginRobot(private val p: SemanticsNodeInteractionsProvider) {
    fun signInAs(email: String, password: String): HomeRobot {
        p.onNodeWithText("Email").performTextInput(email)
        p.onNodeWithText("Password").performTextInput(password)
        p.onNodeWithText("Sign in").performClick()
        return HomeRobot(p)
    }
}
```

Navigation setup itself (a `NavHost` with a `TestNavHostController`, or a Navigation 3 back stack) belongs to the test, not the robot ([navigation.md](../testing-patterns/navigation.md)).

## Design Rules

| Rule | Reason |
| --- | --- |
| One robot per screen or large component | Small, findable, mirrors the UI |
| Expose user intents, not nodes | `submit()`, not `signInButton()`; returning `SemanticsNodeInteraction` leaks structure into tests |
| Keep `setContent`, fakes, and the clock in the test | Arrange stays visible; robots stay reusable |
| No waits or sleeps inside robots | Finders already synchronize; use `waitUntil*` only for work outside Compose ([synchronization.md](synchronization.md)) |
| No conditional logic (`if exists then click`) | Hides real failures; tests must know the state |
| Put robots next to tests in the test source set | They are test code |
| Make finders unique within the screen | Avoid `onAllNodes…[0]`; see [finders-semantics.md](finders-semantics.md) |

## When Not to Use a Robot

- **A single test touches the screen.** Inline finders are clearer than an indirection used once.
- **A small component test** with one or two interactions. `onNodeWithText("Like").performClick()` already reads as intent.
- **The robot would just rename finders** (`fun title() = onNodeWithText("Title")`). That adds a layer without hiding any detail.
- **Logic, not UI, is under test.** Test the ViewModel or the pure function directly ([test-architecture.md](../architecture/test-architecture.md)).

Start inline. Extract a robot when the third test repeats the same steps, or when one UI change breaks several tests in the same way.

## Robots vs Helpers vs Rules

| Tool | Good for |
| --- | --- |
| Screen robot | Interactions and assertions for one screen, reused across tests |
| Extension function on `ComposeContentTestRule` | Content wrappers, such as `setThemedContent { }` ([rules-fixtures.md](rules-fixtures.md#sharing-setup-without-base-classes)) |
| Custom `SemanticsMatcher` | A finder condition reused across screens ([finders-semantics.md](finders-semantics.md)) |
| `TestRule` | Setup and teardown around the test |
| Builders and fakes | Data ([test-data.md](test-data.md)) |

## Anti-Patterns

| Anti-pattern | Problem | Do instead |
| --- | --- | --- |
| Robot calls `setContent` with hidden fakes | Arrange is invisible; hard to vary data | Test calls `setContent` |
| Robot methods return nodes | Tests depend on structure again | Return `Unit`, the robot, or the next robot |
| `Thread.sleep` or `waitUntil` in every action | Slow, hides sync problems | Rely on auto-synchronization |
| A `BaseRobot` with dozens of generic helpers | Becomes a second test API | Small robots; shared matchers |
| Assertions with booleans (`isErrorShown(): Boolean`) | Lose Compose's failure message and tree dump | Call `assert…` inside the robot |
| Robot per test file | Duplication | One robot per screen |

## Related References

- [finders-semantics.md](finders-semantics.md), [assertions.md](assertions.md), [actions-gestures.md](actions-gestures.md): what goes inside a robot
- [rules-fixtures.md](rules-fixtures.md): setup around robots
- [navigation.md](../testing-patterns/navigation.md): multi-screen flows
- [forms-text-input.md](../testing-patterns/forms-text-input.md): text field details
