# Actions and Gestures

## Table of Contents

1. [How Actions Work](#how-actions-work)
2. [Clicks](#clicks)
3. [Text Input](#text-input)
4. [Scrolling to a Node](#scrolling-to-a-node)
5. [Touch Gestures: performTouchInput](#touch-gestures-performtouchinput)
6. [Swipes](#swipes)
7. [Pinch and Multi-Touch](#pinch-and-multi-touch)
8. [Keys: performKeyInput and performKeyPress](#keys-performkeyinput-and-performkeypress)
9. [Mouse Input](#mouse-input)
10. [Semantics Actions](#semantics-actions)
11. [Anti-Patterns to Avoid](#anti-patterns-to-avoid)

## How Actions Work

Actions are `perform…` calls on a `SemanticsNodeInteraction`. Each one synchronizes first (waits for Compose to be idle), then acts on the **single** node the finder matches. There are two kinds:

| Kind | Examples | What it does |
| --- | --- | --- |
| Input injection | `performClick`, `performTouchInput`, `performKeyInput`, `performMouseInput` | Sends synthetic pointer or key events at the node's position, through the same hit testing and gesture detectors a user's finger goes through |
| Semantics actions | `performTextInput`, `performScrollTo`, `performImeAction`, `performSemanticsAction` | Invokes an action the node exposes in semantics (`SetText`, `ScrollBy`, `OnImeAction`, …), like an accessibility service does |

Injected input respects what is really on screen: a click on a disabled button does nothing, and a click on a node covered by another lands on whatever is on top. Semantics actions fail if the node does not expose that action.

One `perform…` call is one action. You cannot chain actions inside a perform function; call them one after another. Actions return the interaction, so a follow-up assertion can chain.

## Clicks

```kotlin
import androidx.compose.foundation.layout.Column
import androidx.compose.material3.Button
import androidx.compose.material3.Text
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

@RunWith(RobolectricTestRunner::class)
class ClickTest {
    @get:Rule
    val composeTestRule = createComposeRule()

    @Test
    fun clicks_onDisabledButton_doNothing() {
        composeTestRule.setContent {
            var votes by remember { mutableIntStateOf(0) }
            Column {
                Text("Votes: $votes")
                Button(onClick = { votes++ }) { Text("Vote") }
                Button(onClick = { votes += 100 }, enabled = false) { Text("Vote x100") }
            }
        }

        composeTestRule.onNodeWithText("Vote").performClick().performClick()
        composeTestRule.onNodeWithText("Vote x100").performClick()

        composeTestRule.onNodeWithText("Votes: 2").assertIsDisplayed()
    }
}
```

`performClick()` injects a down and up at the node's center. Find the node that owns the click (a `Button`'s merged node, which you get by its text); a child found with `useUnmergedTree = true` is usually the same spot, but its own semantics have no click action ([finders-semantics.md](finders-semantics.md#merged-vs-unmerged-tree)).

## Text Input

| Action | Effect |
| --- | --- |
| `performTextInput("abc")` | Inserts text at the cursor. Focuses the field first. Into a field prefilled through `TextField(value = …)` the cursor starts at 0, so the text goes **before** the existing value ([forms-text-input.md](../testing-patterns/forms-text-input.md)) |
| `performTextReplacement("abc")` | Replaces the whole text |
| `performTextClearance()` | Clears the text |
| `performImeAction()` | Triggers the field's IME action (`Done`, `Search`, `Next`, …). Fails with "Failed to perform IME action" when the field's action is `ImeAction.Default` |
| `performTextInputSelection(TextRange(…))` | Sets the selection |

```kotlin
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Text
import androidx.compose.material3.TextField
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertTextContains
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performImeAction
import androidx.compose.ui.test.performTextClearance
import androidx.compose.ui.test.performTextInput
import androidx.compose.ui.test.performTextReplacement
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

@RunWith(RobolectricTestRunner::class)
class TextInputTest {
    @get:Rule
    val composeTestRule = createComposeRule()

    @Test
    fun typeEditAndSubmitSearch() {
        composeTestRule.setContent {
            var query by remember { mutableStateOf("") }
            var submitted by remember { mutableStateOf("") }
            Column {
                TextField(
                    value = query,
                    onValueChange = { query = it },
                    label = { Text("Search") },
                    keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search),
                    keyboardActions = KeyboardActions(onSearch = { submitted = query }),
                )
                Text("Results for: $submitted")
            }
        }
        val field = composeTestRule.onNodeWithText("Search")

        field.performTextInput("kot")
        field.performTextInput("lin")
        field.assertTextContains("kotlin")

        field.performTextReplacement("compose")
        field.performImeAction()
        composeTestRule.onNodeWithText("Results for: compose").assertIsDisplayed()

        field.performTextClearance()
        field.assertTextContains("Search")
    }
}
```

The field is found by its label because the label is part of the field's merged text. Forms, validation, visual transformations, and `TextFieldState`-based fields are in [forms-text-input.md](../testing-patterns/forms-text-input.md).

## Scrolling to a Node

`performScrollTo()` scrolls the nearest scrollable ancestor until the node is visible. It works when the node is **already composed**, which is true in a `Column(Modifier.verticalScroll(…))` but not for off-screen items of a `LazyColumn`.

```kotlin
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsNotDisplayed
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.unit.dp
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

@RunWith(RobolectricTestRunner::class)
class ScrollToTest {
    @get:Rule
    val composeTestRule = createComposeRule()

    @Test
    fun termsAtTheBottom_scrollIntoView() {
        composeTestRule.setContent {
            Column(Modifier.verticalScroll(rememberScrollState())) {
                repeat(30) { Text("Clause ${it + 1}", Modifier.height(48.dp).padding(8.dp)) }
                Text("I agree")
            }
        }
        composeTestRule.onNodeWithText("I agree").assertIsNotDisplayed()

        composeTestRule.onNodeWithText("I agree").performScrollTo().assertIsDisplayed()
    }
}
```

For lazy lists, act on the **list** node instead: `performScrollToIndex(i)`, `performScrollToKey(key)`, or `performScrollToNode(matcher)`, which compose the target item first ([lists-scrolling.md](../testing-patterns/lists-scrolling.md)).

## Touch Gestures: performTouchInput

`performTouchInput { }` gives a `TouchInjectionScope` whose coordinates are in the node's own pixel space. It provides the node's size (`width`, `height`) and named points (`center`, `topLeft`, `centerLeft`, `bottomRight`, …, and `percentOffset(x, y)`).

| Function | Gesture |
| --- | --- |
| `click(position = center)` | Tap |
| `longClick(position = center, durationMillis)` | Long press |
| `doubleClick(position = center, delayMillis)` | Double tap |
| `swipeUp()`, `swipeDown()`, `swipeLeft()`, `swipeRight()` | Swipe across the node (optional start, end, duration) |
| `swipe(start, end, durationMillis)` | Straight swipe between two points |
| `swipeWithVelocity(start, end, endVelocity)` | Swipe ending at a velocity, for flings |
| `pinch(start0, end0, start1, end1, durationMillis)` | Two-finger pinch |
| `down(…)`, `moveTo(…)`, `moveBy(…)`, `up()`, `cancel()` | Low-level pointer control for custom gestures |

Long and double clicks need a composable that handles them, such as `Modifier.combinedClickable`:

```kotlin
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Text
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.doubleClick
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.longClick
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performTouchInput
import androidx.compose.ui.unit.dp
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

@RunWith(RobolectricTestRunner::class)
class LongAndDoubleClickTest {
    @get:Rule
    val composeTestRule = createComposeRule()

    private fun setPhoto() {
        composeTestRule.setContent {
            var status by remember { mutableStateOf("None") }
            Column {
                Text(
                    "Photo",
                    Modifier
                        .combinedClickable(
                            onClick = { status = "Opened" },
                            onLongClick = { status = "Selected" },
                            onDoubleClick = { status = "Liked" },
                        )
                        .padding(24.dp),
                )
                Text("Status: $status")
            }
        }
    }

    @Test
    fun longPress_selectsPhoto() {
        setPhoto()

        composeTestRule.onNodeWithText("Photo").performTouchInput { longClick() }

        composeTestRule.onNodeWithText("Status: Selected").assertIsDisplayed()
    }

    @Test
    fun doubleTap_likesPhoto() {
        setPhoto()

        composeTestRule.onNodeWithText("Photo").performTouchInput { doubleClick() }

        composeTestRule.onNodeWithText("Status: Liked").assertIsDisplayed()
    }
}
```

The injected events advance the test clock (`mainClock`) by the gesture's duration, so long-press and double-tap timeouts are honored without real waiting ([synchronization.md](synchronization.md#the-test-clock)).

## Swipes

A swipe drags across the node. Coordinates come from the node's bounds, so make the node you swipe big enough to contain the gesture.

```kotlin
import androidx.compose.foundation.gestures.detectHorizontalDragGestures
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsNotDisplayed
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performTouchInput
import androidx.compose.ui.test.swipeLeft
import androidx.compose.ui.test.swipeUp
import androidx.compose.ui.unit.dp
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

@RunWith(RobolectricTestRunner::class)
class SwipeTest {
    @get:Rule
    val composeTestRule = createComposeRule()

    @Test
    fun swipeLeft_archivesMessage() {
        composeTestRule.setContent {
            var dragged by remember { mutableFloatStateOf(0f) }
            var archived by remember { mutableStateOf(false) }
            Text(
                if (archived) "Archived" else "Message from Ada",
                Modifier
                    .fillMaxWidth()
                    .height(72.dp)
                    .testTag("message")
                    .pointerInput(Unit) {
                        detectHorizontalDragGestures(
                            onDragEnd = { if (dragged < -size.width / 2) archived = true },
                            onHorizontalDrag = { _, delta -> dragged += delta },
                        )
                    },
            )
        }

        composeTestRule.onNodeWithTag("message").performTouchInput { swipeLeft() }

        composeTestRule.onNodeWithText("Archived").assertIsDisplayed()
    }

    @Test
    fun swipeUp_scrollsTheList() {
        composeTestRule.setContent {
            Column(Modifier.testTag("feed").verticalScroll(rememberScrollState())) {
                repeat(20) { Text("Post ${it + 1}", Modifier.height(80.dp).padding(8.dp)) }
            }
        }

        composeTestRule.onNodeWithText("Post 1").assertIsDisplayed()

        composeTestRule.onNodeWithTag("feed").performTouchInput { swipeUp() }

        composeTestRule.onNodeWithText("Post 1").assertIsNotDisplayed()
    }
}
```

`swipeLeft()` runs from `centerRight` to `centerLeft` and `swipeUp()` from `bottomCenter` to `topCenter`, by default. Pass `startX`/`endX` (or `startY`/`endY`) and `durationMillis` to change them. For Material components with anchored drag (`SwipeToDismissBox`, sheets), see [dialogs-popups.md](../testing-patterns/dialogs-popups.md).

## Pinch and Multi-Touch

```kotlin
import androidx.compose.foundation.gestures.rememberTransformableState
import androidx.compose.foundation.gestures.transformable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.size
import androidx.compose.material3.Text
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performTouchInput
import androidx.compose.ui.test.pinch
import androidx.compose.ui.unit.dp
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

@RunWith(RobolectricTestRunner::class)
class PinchTest {
    @get:Rule
    val composeTestRule = createComposeRule()

    @Test
    fun pinchOut_zoomsIn() {
        composeTestRule.setContent {
            var scale by remember { mutableFloatStateOf(1f) }
            val state = rememberTransformableState { _, zoomChange, _, _ -> scale *= zoomChange }
            Column {
                Box(Modifier.size(200.dp).testTag("map").transformable(state))
                Text(if (scale > 1.5f) "Zoomed in" else "Normal")
            }
        }

        composeTestRule.onNodeWithTag("map").performTouchInput {
            pinch(
                start0 = center + Offset(-10f, 0f),
                end0 = center + Offset(-100f, 0f),
                start1 = center + Offset(10f, 0f),
                end1 = center + Offset(100f, 0f),
            )
        }

        composeTestRule.onNodeWithText("Zoomed in").assertIsDisplayed()
    }
}
```

For other multi-finger gestures, use `down(pointerId, position)`, `moveTo(pointerId, position)`, `move()`, and `up(pointerId)`, or `multiTouchSwipe`.

## Keys: performKeyInput and performKeyPress

`performKeyInput { }` sends hardware key events to the node, which must be **focused** (or contain the focused node). `pressKey(Key.X)` is a down plus up; `withKeyDown(Key.ShiftLeft) { … }` holds a modifier; `keyDown`/`keyUp` give full control.

```kotlin
import androidx.compose.foundation.focusable
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.size
import androidx.compose.material3.Text
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.ExperimentalComposeUiApi
import androidx.compose.ui.Modifier
import androidx.compose.ui.input.key.Key
import androidx.compose.ui.input.key.KeyEventType
import androidx.compose.ui.input.key.isShiftPressed
import androidx.compose.ui.input.key.key
import androidx.compose.ui.input.key.onKeyEvent
import androidx.compose.ui.input.key.type
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.test.ExperimentalTestApi
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performKeyInput
import androidx.compose.ui.test.pressKey
import androidx.compose.ui.test.requestFocus
import androidx.compose.ui.test.withKeyDown
import androidx.compose.ui.unit.dp
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

@OptIn(ExperimentalTestApi::class, ExperimentalComposeUiApi::class)
@RunWith(RobolectricTestRunner::class)
class KeyInputTest {
    @get:Rule
    val composeTestRule = createComposeRule()

    @Test
    fun arrowKeys_moveTheSelection() {
        composeTestRule.setContent {
            var index by remember { mutableIntStateOf(0) }
            Column(
                Modifier
                    .size(200.dp)
                    .testTag("picker")
                    .onKeyEvent { event ->
                        if (event.type != KeyEventType.KeyDown) return@onKeyEvent false
                        val step = if (event.isShiftPressed) 10 else 1
                        when (event.key) {
                            Key.DirectionDown -> { index += step; true }
                            Key.DirectionUp -> { index -= step; true }
                            else -> false
                        }
                    }
                    .focusable(),
            ) {
                Text("Item $index")
            }
        }
        val picker = composeTestRule.onNodeWithTag("picker")
        picker.requestFocus()

        picker.performKeyInput {
            pressKey(Key.DirectionDown)
            pressKey(Key.DirectionDown)
            withKeyDown(Key.ShiftLeft) { pressKey(Key.DirectionDown) }
        }

        composeTestRule.onNodeWithText("Item 12").assertIsDisplayed()
    }
}
```

- `requestFocus()` invokes the node's `RequestFocus` semantics action.
- `performKeyPress(android.view.KeyEvent)` sends one Android `KeyEvent` and returns whether it was consumed. Prefer `performKeyInput`, which builds down/up pairs and modifier state for you.
- Which APIs need `@OptIn(ExperimentalTestApi::class)` changes between releases; the compiler tells you.

## Mouse Input

`performMouseInput { }` injects mouse events: `moveTo`, `moveBy`, `click`, `rightClick`, `doubleClick`, `longClick`, `press`/`release`, `scroll`, `enter`/`exit`, and `dragAndDrop`. Use it for hover states, context menus, and desktop-style interactions.

```kotlin
import androidx.compose.foundation.hoverable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsHoveredAsState
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.size
import androidx.compose.material3.Text
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.test.ExperimentalTestApi
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performMouseInput
import androidx.compose.ui.unit.dp
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

@OptIn(ExperimentalTestApi::class)
@RunWith(RobolectricTestRunner::class)
class HoverTest {
    @get:Rule
    val composeTestRule = createComposeRule()

    @Test
    fun hoveringTheCard_showsTooltip() {
        composeTestRule.setContent {
            val source = remember { MutableInteractionSource() }
            val hovered by source.collectIsHoveredAsState()
            Column {
                Text("Card", Modifier.size(120.dp).testTag("card").hoverable(source))
                if (hovered) Text("Open in new window")
            }
        }

        composeTestRule.onNodeWithTag("card").performMouseInput { moveTo(center) }

        composeTestRule.onNodeWithText("Open in new window").assertIsDisplayed()
    }
}
```

## Semantics Actions

`performSemanticsAction(key)` invokes an action from `SemanticsActions` directly, without input events. Use it for actions with no simple gesture (setting a slider value) or to act the way an accessibility service would. `performCustomAccessibilityActionWithLabel(label)` invokes a custom action added with `customActions`.

```kotlin
import androidx.compose.foundation.layout.Column
import androidx.compose.material3.Slider
import androidx.compose.material3.Text
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.CustomAccessibilityAction
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.semantics.customActions
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.test.ExperimentalTestApi
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performCustomAccessibilityActionWithLabel
import androidx.compose.ui.test.performSemanticsAction
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import kotlin.math.roundToInt

@OptIn(ExperimentalTestApi::class)
@RunWith(RobolectricTestRunner::class)
class SemanticsActionsTest {
    @get:Rule
    val composeTestRule = createComposeRule()

    @Test
    fun setProgress_movesTheSlider() {
        composeTestRule.setContent {
            var volume by remember { mutableFloatStateOf(0.2f) }
            Column {
                Slider(value = volume, onValueChange = { volume = it }, modifier = Modifier.testTag("volume"))
                Text("Volume ${(volume * 100).roundToInt()}%")
            }
        }

        composeTestRule.onNodeWithTag("volume").performSemanticsAction(SemanticsActions.SetProgress) { setProgress ->
            setProgress(0.8f)
        }

        composeTestRule.onNodeWithText("Volume 80%").assertIsDisplayed()
    }

    @Test
    fun customAction_deletesTheRow() {
        composeTestRule.setContent {
            val emails = remember { mutableStateListOf("Invoice", "Newsletter") }
            Column {
                emails.forEach { subject ->
                    Text(
                        subject,
                        Modifier.semantics {
                            customActions = listOf(CustomAccessibilityAction("Delete") { emails.remove(subject) })
                        },
                    )
                }
                Text("${emails.size} emails")
            }
        }

        composeTestRule.onNodeWithText("Newsletter").performCustomAccessibilityActionWithLabel("Delete")

        composeTestRule.onNodeWithText("1 emails").assertIsDisplayed()
    }
}
```

Prefer input injection when a user would use a gesture. `performSemanticsAction(SemanticsActions.OnClick)` on a **disabled** Material `Button` still runs its `onClick`, while `performClick()` does nothing, as a finger would. Use semantics actions when there is no realistic gesture to inject.

## Anti-Patterns to Avoid

| Anti-Pattern | Problem | Solution |
| --- | --- | --- |
| Acting on an unmerged child (`useUnmergedTree = true`) to click | The child has no click action in semantics; easy to hit the wrong spot | Act on the merged node found by its text |
| `performScrollTo()` on a lazy item that is not composed | The node does not exist yet | `performScrollToIndex`/`ToKey`/`ToNode` on the list |
| Swiping a node smaller than the gesture | Swipe starts or ends outside the detector | Swipe the container that owns the gesture |
| `performKeyInput` on an unfocused node | Events go to whatever has focus | `requestFocus()` (or click) first |
| `performSemanticsAction(OnClick)` instead of `performClick()` | Skips hit testing and the enabled state's effect on input | `performClick()`; semantics actions for gestures that do not exist |
| `Thread.sleep` between down and up for a long press | The test clock, not wall time, drives gesture timing | `longClick(durationMillis = …)` |
| Several user steps inside one `performTouchInput` for unrelated nodes | Coordinates are relative to one node | One `perform…` per node |
| `performGesture { }` | Deprecated | `performTouchInput { }` |

## Related References

- **Finding the node to act on**: [finders-semantics.md](finders-semantics.md)
- **Checking the result**: [assertions.md](assertions.md)
- **Work that continues after an action**: [synchronization.md](synchronization.md)
- **Lazy lists**: [lists-scrolling.md](../testing-patterns/lists-scrolling.md)
- **Text fields and IME**: [forms-text-input.md](../testing-patterns/forms-text-input.md)
- **Sheets, swipe-to-dismiss, menus**: [dialogs-popups.md](../testing-patterns/dialogs-popups.md)
- **Back press and activity input**: [activities-intents.md](../testing-patterns/activities-intents.md)
