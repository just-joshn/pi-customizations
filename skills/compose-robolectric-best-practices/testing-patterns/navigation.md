# Navigation

## Table of Contents

1. [What to Test](#what-to-test)
2. [Screens Take Callbacks, Not a NavController](#screens-take-callbacks-not-a-navcontroller)
3. [Navigation Compose with TestNavHostController](#navigation-compose-with-testnavhostcontroller)
4. [Starting at a Deep Destination](#starting-at-a-deep-destination)
5. [Back Stack and Back Press](#back-stack-and-back-press)
6. [Navigation 3: You Own the Back Stack](#navigation-3-you-own-the-back-stack)
7. [Anti-Patterns](#anti-patterns)

## What to Test

| Question | Test |
| --- | --- |
| Does this screen ask to go somewhere when the user taps X? | The screen alone, with a callback; assert the callback's argument |
| Does the graph wire route X to screen Y with the right arguments? | The `NavHost` with a `TestNavHostController` and simple screens |
| Does back return to the right place, and does state survive? | The `NavHost` (or `NavDisplay`) plus a back press |
| Does a whole flow work end to end? | A few tests over the real graph with fake data; keep most coverage at the screen level |

The Compose navigation testing guide recommends decoupling screens from navigation: pass navigation events as lambdas so a screen can be tested without a `NavController`.

## Screens Take Callbacks, Not a NavController

```kotlin
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Column
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import com.google.common.truth.Truth.assertThat
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

@Composable
fun OrdersScreen(orderIds: List<String>, onOpenOrder: (String) -> Unit) {
    Column {
        orderIds.forEach { id ->
            Text("Order $id", Modifier.clickable { onOpenOrder(id) })
        }
    }
}

@RunWith(RobolectricTestRunner::class)
class OrdersScreenTest {
    @get:Rule val composeTestRule = createComposeRule()

    @Test
    fun tappingAnOrderAsksToOpenIt() {
        val opened = mutableListOf<String>()
        composeTestRule.setContent { OrdersScreen(listOf("17", "42"), onOpenOrder = { opened += it }) }

        composeTestRule.onNodeWithText("Order 42").performClick()

        assertThat(opened).containsExactly("42")
    }
}
```

This test needs no navigation library at all and stays valid if the app moves from Navigation Compose to Navigation 3.

## Navigation Compose with TestNavHostController

`TestNavHostController` (from `androidx.navigation:navigation-testing`) is a real `NavHostController` with test helpers. Create it inside `setContent` with the current `Context`, register a `ComposeNavigator`, and pass it to the app's `NavHost`.

The examples use string routes. Type-safe routes (`composable<Detail>`, `hasRoute<Detail>()`) need the Kotlin serialization plugin on the module; with it, assert `currentBackStackEntry?.destination?.hasRoute<Detail>()` instead of comparing route strings.

```kotlin
import androidx.compose.foundation.clickable
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.navigation.NavHostController
import androidx.navigation.compose.ComposeNavigator
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.testing.TestNavHostController
import com.google.common.truth.Truth.assertThat
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

@Composable
fun ShopNavHost(navController: NavHostController) {
    NavHost(navController, startDestination = "catalog") {
        composable("catalog") {
            Text("Blue mug", Modifier.clickable { navController.navigate("product/mug-1") })
        }
        composable("product/{id}") { entry ->
            Text("Product ${entry.arguments?.getString("id")}")
        }
    }
}

@RunWith(RobolectricTestRunner::class)
class ShopNavHostTest {
    @get:Rule val composeTestRule = createComposeRule()

    private lateinit var navController: TestNavHostController

    @Before
    fun setUp() {
        composeTestRule.setContent {
            navController = TestNavHostController(LocalContext.current)
            navController.navigatorProvider.addNavigator(ComposeNavigator())
            ShopNavHost(navController)
        }
    }

    @Test
    fun startsOnTheCatalog() {
        composeTestRule.onNodeWithText("Blue mug").assertIsDisplayed()
        assertThat(navController.currentBackStackEntry?.destination?.route).isEqualTo("catalog")
    }

    @Test
    fun tappingAProductOpensItsPage() {
        composeTestRule.onNodeWithText("Blue mug").performClick()

        composeTestRule.onNodeWithText("Product mug-1").assertIsDisplayed()
        assertThat(navController.currentBackStackEntry?.destination?.route).isEqualTo("product/{id}")
        assertThat(navController.currentBackStackEntry?.arguments?.getString("id")).isEqualTo("mug-1")
    }
}
```

`destination.route` is the route **pattern** (`product/{id}`); read arguments from the entry. Assert the visible screen first: it proves the destination composed, and the finder waits for the `NavHost` transition to finish before the controller is checked.

## Starting at a Deep Destination

To test a destination's wiring without clicking through the graph, navigate on the UI thread after the graph is set. `TestNavHostController.setCurrentDestination` also exists; it replaces the current destination without building a back stack.

```kotlin
import androidx.compose.material3.Text
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.navigation.compose.ComposeNavigator
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.testing.TestNavHostController
import com.google.common.truth.Truth.assertThat
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

@RunWith(RobolectricTestRunner::class)
class DeepDestinationTest {
    @get:Rule val composeTestRule = createComposeRule()

    @Test
    fun receiptShowsTheOrderFromTheRoute() {
        lateinit var navController: TestNavHostController
        composeTestRule.setContent {
            navController = TestNavHostController(LocalContext.current)
            navController.navigatorProvider.addNavigator(ComposeNavigator())
            NavHost(navController, startDestination = "home") {
                composable("home") { Text("Home") }
                composable("receipt/{orderId}") { entry ->
                    Text("Receipt for ${entry.arguments?.getString("orderId")}")
                }
            }
        }

        composeTestRule.runOnUiThread { navController.navigate("receipt/A-100") }

        composeTestRule.onNodeWithText("Receipt for A-100").assertIsDisplayed()
        assertThat(navController.previousBackStackEntry?.destination?.route).isEqualTo("home")
    }
}
```

## Back Stack and Back Press

`NavHost` registers a back handler with the activity, so `Espresso.pressBack()` pops the stack the same way the system back button does. Check both the visible screen and the controller.

```kotlin
import androidx.compose.foundation.layout.Column
import androidx.compose.material3.Button
import androidx.compose.material3.Text
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.navigation.compose.ComposeNavigator
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.testing.TestNavHostController
import androidx.test.espresso.Espresso
import com.google.common.truth.Truth.assertThat
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

@RunWith(RobolectricTestRunner::class)
class BackStackTest {
    @get:Rule val composeTestRule = createComposeRule()

    @Test
    fun backReturnsToTheListWithItsStateKept() {
        lateinit var navController: TestNavHostController
        composeTestRule.setContent {
            navController = TestNavHostController(LocalContext.current)
            navController.navigatorProvider.addNavigator(ComposeNavigator())
            NavHost(navController, startDestination = "list") {
                composable("list") {
                    var likes by rememberSaveable { mutableIntStateOf(0) }
                    Column {
                        Button(onClick = { likes++ }) { Text("Likes: $likes") }
                        Button(onClick = { navController.navigate("settings") }) { Text("Settings") }
                    }
                }
                composable("settings") { Text("Settings screen") }
            }
        }
        composeTestRule.onNodeWithText("Likes: 0").performClick()
        composeTestRule.onNodeWithText("Settings").performClick()
        composeTestRule.onNodeWithText("Settings screen").assertIsDisplayed()
        assertThat(navController.backStack.map { it.destination.route }.takeLast(2))
            .containsExactly("list", "settings").inOrder()

        Espresso.pressBack()

        composeTestRule.onNodeWithText("Likes: 1").assertIsDisplayed()
        assertThat(navController.currentBackStackEntry?.destination?.route).isEqualTo("list")
        assertThat(navController.previousBackStackEntry).isNull()
    }
}
```

`rememberSaveable` state on the list survives the round trip because `NavHost` saves it with the back stack entry. A plain `remember` would reset to 0, which is a real bug this test would catch. Don't press back on the start destination: there is nothing to pop, so the press goes to the activity and finishes it.

To inspect the whole stack, `TestNavHostController.backStack` returns the entries; it also contains the `NavGraph`'s own entry, so map to `destination.route` and keep the routes you care about.

## Navigation 3: You Own the Back Stack

In Navigation 3 the back stack is a list your code owns, and `NavDisplay` renders its last entry. The test can create the list, pass it in, and assert on it directly. No test controller is needed.

```kotlin
import androidx.compose.foundation.clickable
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.snapshots.SnapshotStateList
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.navigation3.runtime.entryProvider
import androidx.navigation3.ui.NavDisplay
import androidx.test.espresso.Espresso
import com.google.common.truth.Truth.assertThat
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

data object Inbox
data class Thread(val id: Int)

@Composable
fun MailApp(backStack: SnapshotStateList<Any>) {
    NavDisplay(
        backStack = backStack,
        onBack = { backStack.removeLastOrNull() },
        entryProvider = entryProvider {
            entry<Inbox> {
                Text("Thread 7: Lunch?", Modifier.clickable { backStack.add(Thread(7)) })
            }
            entry<Thread> { key -> Text("Reading thread ${key.id}") }
        },
    )
}

@RunWith(RobolectricTestRunner::class)
class MailAppTest {
    @get:Rule val composeTestRule = createComposeRule()

    @Test
    fun openingAThreadPushesItAndBackPopsIt() {
        val backStack = mutableStateListOf<Any>(Inbox)
        composeTestRule.setContent { MailApp(backStack) }

        composeTestRule.onNodeWithText("Thread 7: Lunch?").performClick()

        composeTestRule.onNodeWithText("Reading thread 7").assertIsDisplayed()
        assertThat(backStack).containsExactly(Inbox, Thread(7)).inOrder()

        Espresso.pressBack()

        composeTestRule.onNodeWithText("Thread 7: Lunch?").assertIsDisplayed()
        assertThat(backStack).containsExactly(Inbox)
    }

    @Test
    fun startsFromAnyStackTheTestBuilds() {
        val backStack = mutableStateListOf<Any>(Inbox, Thread(3))
        composeTestRule.setContent { MailApp(backStack) }

        composeTestRule.onNodeWithText("Reading thread 3").assertIsDisplayed()
    }
}
```

Building the starting stack in the test replaces deep-link setup: any screen, with any history, is one list away. In the app, `rememberNavBackStack` persists the stack across process death and requires keys that implement `NavKey` and are `@Serializable`; tests that hand `NavDisplay` a plain `mutableStateListOf` don't need that.

## Anti-Patterns

| Anti-Pattern | Problem | Solution |
| --- | --- | --- |
| Passing `NavController` into every screen | Every screen test needs a graph | Screens take lambdas; only the `NavHost` knows routes |
| Asserting only `currentBackStackEntry` | Passes even if the destination renders the wrong content | Assert the visible screen first, then the controller |
| Comparing `destination.route` to `"product/mug-1"` | `route` is the pattern `product/{id}` | Compare the pattern; read arguments from the entry |
| Calling `navController.navigate` from the test thread outside the UI thread | Navigation must run on the main thread | `composeTestRule.runOnUiThread { ... }` |
| A mocked `NavController` | Verifies calls, not that the graph resolves | `TestNavHostController` with the real graph |
| Pressing back on the start destination | Activity finishes; following finders fail | Assert the start destination by other means |
| Clicking through five screens to reach the one under test | Slow, brittle, failures point at the wrong screen | Navigate directly, or build the Navigation 3 stack |

## Related References

- **Back press, activities, and intents**: [activities-intents.md](activities-intents.md)
- **State that must survive navigation and recreation**: [configuration-changes.md](configuration-changes.md)
- **Screens backed by a ViewModel**: [viewmodel-state.md](viewmodel-state.md)
- **Screen robots for multi-step flows**: [screen-robots.md](../core/screen-robots.md)
- **Waiting for transitions**: [synchronization.md](../core/synchronization.md), [animations-clock.md](animations-clock.md)
