# View Interop: AndroidView, ComposeView, and Espresso

## Table of Contents

1. [Two Finders, Two Trees](#two-finders-two-trees)
2. [Views Inside Compose (AndroidView)](#views-inside-compose-androidview)
3. [Compose Inside Views (ComposeView)](#compose-inside-views-composeview)
4. [Scoping Compose Finders to a View](#scoping-compose-finders-to-a-view)
5. [Fragments](#fragments)
6. [Anti-Patterns](#anti-patterns)
7. [Related References](#related-references)

## Two Finders, Two Trees

A hybrid screen has two hierarchies, and each test API sees only one of them:

| Content | Find with | Does not see |
| --- | --- | --- |
| Composables (including those inside a `ComposeView`) | `composeTestRule.onNode…` | Text and IDs of Android Views |
| Android Views (including those inside an `AndroidView`) | Espresso `onView(…)` | Text of composables |

There are no extra steps: use both in the same test. In our Robolectric runs a click through one API was visible to the other's next assertion without extra waiting. Also seen:

- `onView(withText("Tap"))` on a Compose `Button` failed with `NoMatchingViewException: No views in hierarchy found matching: an instance of android.widget.TextView and view.getText() with or without transformation to match: is "Tap"`.
- `composeTestRule.onNodeWithText("Legacy")` on a `TextView` inside `AndroidView` failed with `Expected exactly '1' node but could not find any node that satisfies: (Text + InputText + EditableText contains 'Legacy' (ignoreCase: false))`.

## Views Inside Compose (AndroidView)

```kotlin
import android.widget.TextView
import androidx.compose.foundation.layout.Column
import androidx.compose.material3.Button
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.viewinterop.AndroidView
import androidx.test.espresso.Espresso.onView
import androidx.test.espresso.action.ViewActions.click
import androidx.test.espresso.assertion.ViewAssertions.matches
import androidx.test.espresso.matcher.ViewMatchers.isDisplayed
import androidx.test.espresso.matcher.ViewMatchers.withText
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

@Composable
fun LegacyBadge() {
    var count by remember { mutableStateOf(0) }
    Column {
        Button(onClick = { count++ }) { Text("Add") }
        AndroidView(
            factory = { context -> TextView(context) },
            update = { view -> view.text = "Badge: $count" },
        )
    }
}

@RunWith(RobolectricTestRunner::class)
class LegacyBadgeTest {
    @get:Rule val composeTestRule = createComposeRule()

    @Test
    fun composeClickUpdatesTheView() {
        composeTestRule.setContent { LegacyBadge() }

        onView(withText("Badge: 0")).check(matches(isDisplayed()))
        composeTestRule.onNodeWithText("Add").performClick()
        onView(withText("Badge: 1")).check(matches(isDisplayed()))
    }

    @Test
    fun viewClickUpdatesCompose() {
        composeTestRule.setContent {
            var clicks by remember { mutableStateOf(0) }
            Column {
                Text("Clicks: $clicks")
                AndroidView(factory = { context ->
                    TextView(context).apply {
                        text = "Legacy button"
                        setOnClickListener { clicks++ }
                    }
                })
            }
        }

        onView(withText("Legacy button")).perform(click())
        composeTestRule.onNodeWithText("Clicks: 1").assertExists()
    }
}
```

The `update` block runs after recomposition, so assert the View after a synchronizing Compose call (here `performClick`) rather than immediately after changing state from the test.

## Compose Inside Views (ComposeView)

When a View-based screen hosts a `ComposeView`, build or launch that screen and let the Compose rule find the composables in it. `createAndroidComposeRule<ComponentActivity>()` gives an empty activity whose content you can replace on the main thread with `scenario.onActivity`:

```kotlin
import android.widget.LinearLayout
import android.widget.TextView
import androidx.activity.ComponentActivity
import androidx.compose.material3.Button
import androidx.compose.material3.Text
import androidx.compose.ui.platform.ComposeView
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.test.espresso.Espresso.onView
import androidx.test.espresso.assertion.ViewAssertions.matches
import androidx.test.espresso.matcher.ViewMatchers.withId
import androidx.test.espresso.matcher.ViewMatchers.withText
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

@RunWith(RobolectricTestRunner::class)
class HybridScreenTest {
    @get:Rule val composeTestRule = createAndroidComposeRule<ComponentActivity>()

    @Test
    fun composeButtonUpdatesLegacyLabel() {
        composeTestRule.activityRule.scenario.onActivity { activity ->
            val label = TextView(activity).apply {
                id = android.R.id.text1
                text = "Clicks: 0"
            }
            var clicks = 0
            val composeView = ComposeView(activity).apply {
                setContent {
                    Button(onClick = { clicks++; label.text = "Clicks: $clicks" }) { Text("Tap") }
                }
            }
            activity.setContentView(
                LinearLayout(activity).apply {
                    orientation = LinearLayout.VERTICAL
                    addView(label)
                    addView(composeView)
                },
            )
        }

        composeTestRule.onNodeWithText("Tap").performClick()

        onView(withId(android.R.id.text1)).check(matches(withText("Clicks: 1")))
    }
}
```

In a real app the activity (declared in the manifest) inflates this layout itself; launch it with `createAndroidComposeRule<YourActivity>()` and skip `onActivity` ([activities-intents.md](activities-intents.md)). `onView(withId(…))` works under Robolectric as on a device.

## Scoping Compose Finders to a View

Identical composables in several `ComposeView`s (RecyclerView rows, ViewPager pages, repeated panes) make `onNodeWithText("Save")` fail with `Expected exactly '1' node but found '2' nodes`. Compose 1.12 adds `onRootWithViewInteraction`, which restricts the search to the Compose content inside one Espresso-matched View:

```kotlin
import android.content.Context
import android.view.View
import android.widget.FrameLayout
import android.widget.LinearLayout
import androidx.activity.ComponentActivity
import androidx.compose.foundation.layout.Column
import androidx.compose.material3.Button
import androidx.compose.material3.Text
import androidx.compose.ui.platform.ComposeView
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.junit4.onRootWithViewInteraction
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.test.espresso.Espresso.onView
import androidx.test.espresso.matcher.ViewMatchers.withId
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

private fun pane(context: Context, paneId: Int, title: String, onSave: () -> Unit): View =
    FrameLayout(context).apply {
        id = paneId
        addView(ComposeView(context).apply {
            setContent {
                Column {
                    Text(title)
                    Button(onClick = onSave) { Text("Save") }
                }
            }
        })
    }

@RunWith(RobolectricTestRunner::class)
class TwoPaneTest {
    @get:Rule val composeTestRule = createAndroidComposeRule<ComponentActivity>()

    @Test
    fun savesOnlyTheRightPane() {
        val saved = mutableListOf<String>()
        composeTestRule.activityRule.scenario.onActivity { activity ->
            activity.setContentView(
                LinearLayout(activity).apply {
                    orientation = LinearLayout.VERTICAL
                    addView(pane(activity, LEFT, "Draft A") { saved += "A" })
                    addView(pane(activity, RIGHT, "Draft B") { saved += "B" })
                },
            )
        }
        composeTestRule.onAllNodesWithText("Save").assertCountEquals(2)

        val rightPane = composeTestRule.onRootWithViewInteraction(onView(withId(RIGHT)))
        rightPane.onNodeWithText("Draft A").assertDoesNotExist()
        rightPane.onNodeWithText("Save").performClick()

        composeTestRule.runOnIdle { check(saved == listOf("B")) }
    }

    private companion object {
        const val LEFT = 101
        const val RIGHT = 102
    }
}
```

The API is documented as experimental in 1.12; prefer distinct, user-visible text when the screen already has it.

## Fragments

`fragment-testing` is not part of this skill's verified setup. The same rules apply once a fragment's view is on screen: composables in its `ComposeView` are found with the Compose rule, its Views with Espresso. Keep fragment hosting minimal and test the composable it shows directly where possible ([test-architecture.md](../architecture/test-architecture.md)).

## Anti-Patterns

| Anti-Pattern | Problem | Solution |
| --- | --- | --- |
| `onView(withText(…))` for a composable | Espresso does not see Compose text | `composeTestRule.onNodeWithText` |
| `onNodeWithText` for a `TextView` inside `AndroidView` | Compose semantics do not include View text | Espresso `onView` |
| Touching Views from the test without `onActivity` / `runOnUiThread` | Views are main-thread objects | Mutate them in `scenario.onActivity { }` |
| Adding test tags to every row to disambiguate repeated `ComposeView`s | Production noise | `onRootWithViewInteraction` |
| Testing a whole View-based activity to check one composable | Slow, brittle setup | `createComposeRule` + the composable directly |

## Related References

- **Activities and the manifest**: [activities-intents.md](activities-intents.md)
- **Finders and "found N nodes" errors**: [finders-semantics.md](../core/finders-semantics.md)
- **Synchronization across Views and Compose**: [synchronization.md](../core/synchronization.md)
- **Choosing what to test**: [test-architecture.md](../architecture/test-architecture.md)
