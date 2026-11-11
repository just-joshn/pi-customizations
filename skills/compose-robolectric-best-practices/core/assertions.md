# Assertions

## Table of Contents

1. [How Assertions Work](#how-assertions-work)
2. [Existence and Visibility](#existence-and-visibility)
3. [Text and Content Description](#text-and-content-description)
4. [State: Enabled, Selected, On/Off, Focused](#state-enabled-selected-onoff-focused)
5. [assert(matcher) and expectValue](#assertmatcher-and-expectvalue)
6. [Collections](#collections)
7. [Size and Position](#size-and-position)
8. [Asserting Outcomes Outside the UI](#asserting-outcomes-outside-the-ui)
9. [Reading Values for Other Assertion Libraries](#reading-values-for-other-assertion-libraries)
10. [Anti-Patterns to Avoid](#anti-patterns-to-avoid)

## How Assertions Work

An assertion is called on the `SemanticsNodeInteraction` a finder returns ([finders-semantics.md](finders-semantics.md)). Before it checks anything it **synchronizes**: it waits until Compose is idle, running pending recompositions and layout ([synchronization.md](synchronization.md)). Then it checks once. It does **not** retry until a timeout the way Playwright's web-first assertions do. When the expected state arrives only after work Compose does not track (a delay, another thread), wait first with a `waitUntil…` helper, then assert.

Every assertion returns the interaction, so they chain:

```kotlin snippet
composeTestRule.onNodeWithText("Submit")
    .assertIsDisplayed()
    .assertIsEnabled()
    .assertHasClickAction()
```

A failed assertion throws `AssertionError` with the matcher, the reason, and the nodes it found. There are no soft assertions; the first failure ends the test.

## Existence and Visibility

| Assertion | Passes when | Use for |
| --- | --- | --- |
| `assertExists()` | Exactly one node matches, in the tree, visible or not | Something is composed (possibly off screen) |
| `assertDoesNotExist()` | No node matches | Something was removed, never shown, or is a lazy item not composed |
| `assertIsDisplayed()` | Exactly one node matches **and** some of it is inside the window and not clipped away | What the user can see. The default choice |
| `assertIsNotDisplayed()` | The node is not on screen, **including when no node matches** | Rarely; prefer one of the above |
| `isDisplayed()` / `isNotDisplayed()` | Return a `Boolean` instead of throwing | Conditions in `waitUntil { }` |

```kotlin
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.height
import androidx.compose.material3.Button
import androidx.compose.material3.Text
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsNotDisplayed
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.unit.dp
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

@RunWith(RobolectricTestRunner::class)
class VisibilityTest {
    @get:Rule
    val composeTestRule = createComposeRule()

    @Test
    fun dismiss_removesBanner() {
        composeTestRule.setContent {
            var showBanner by remember { mutableStateOf(true) }
            Column {
                if (showBanner) Text("New version available")
                Button(onClick = { showBanner = false }) { Text("Dismiss") }
            }
        }

        composeTestRule.onNodeWithText("Dismiss").performClick()

        composeTestRule.onNodeWithText("New version available").assertDoesNotExist()
    }

    @Test
    fun footer_existsButIsBelowTheWindow() {
        composeTestRule.setContent {
            Column {
                Spacer(Modifier.height(1_000.dp))
                Text("Footer")
            }
        }

        composeTestRule.onNodeWithText("Footer").assertExists()
        composeTestRule.onNodeWithText("Footer").assertIsNotDisplayed()
    }
}
```

- When no node matches, `assertIsDisplayed()` fails with "… is not displayed!", which reads like an off-screen problem. If the message surprises you, try `assertExists()`, whose message says "could not find any node".
- `assertIsNotDisplayed()` also passes when the node does not exist, so a typo in the finder makes it pass. Use `assertDoesNotExist()` for "gone", and `assertExists()` plus `assertIsNotDisplayed()` for "composed but off screen".
- Robolectric's default window is 320×470dp, so content further down is not displayed until scrolled ([setup-configuration.md](setup-configuration.md#qualifiers-and-the-default-device)). Lazy list items outside the viewport are usually not composed at all, so they do not exist ([lists-scrolling.md](../testing-patterns/lists-scrolling.md)).
- Visibility is computed from layout bounds and clipping. It does not look at alpha, color, or what is drawn on top.

## Text and Content Description

| Assertion | Checks |
| --- | --- |
| `assertTextEquals(vararg values, includeEditableText = true)` | The node's text values, in order, equal `values` exactly |
| `assertTextContains(value, substring = false, ignoreCase = false)` | Some text value equals (or, with `substring`, contains) `value` |
| `assertContentDescriptionEquals(vararg values)` | Content descriptions equal `values` |
| `assertContentDescriptionContains(value, substring = false, ignoreCase = false)` | Some content description matches |
| `assertValueEquals(value)` | The `StateDescription` equals `value` |

A merged node can hold several text values: a button's labels, or a text field's label plus its typed text (`EditableText`).

```kotlin
import androidx.compose.material3.Button
import androidx.compose.material3.Text
import androidx.compose.material3.TextField
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.foundation.layout.Column
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.test.assertTextContains
import androidx.compose.ui.test.assertTextEquals
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performTextInput
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

@RunWith(RobolectricTestRunner::class)
class TextAssertionsTest {
    @get:Rule
    val composeTestRule = createComposeRule()

    @Test
    fun textValues_ofMergedNodes() {
        composeTestRule.setContent {
            var email by remember { mutableStateOf("") }
            Column {
                TextField(email, { email = it }, Modifier.testTag("email"), label = { Text("Email") })
                Button(onClick = {}) {
                    Text("Pay")
                    Text("€12.50")
                }
            }
        }

        composeTestRule.onNodeWithTag("email").performTextInput("ada@example.com")

        composeTestRule.onNodeWithTag("email").assertTextEquals("Email", "ada@example.com")
        composeTestRule.onNodeWithTag("email").assertTextEquals("Email", includeEditableText = false)
        composeTestRule.onNodeWithText("Pay").assertTextEquals("Pay", "€12.50")
        composeTestRule.onNodeWithText("Pay").assertTextContains("12.50", substring = true)
    }
}
```

`assertTextEquals` is strict about the full list. When a node has a label you do not care about, `assertTextContains` on the value you do care about is less brittle. Text field details (placeholders, visual transformations, IME) are in [forms-text-input.md](../testing-patterns/forms-text-input.md).

## State: Enabled, Selected, On/Off, Focused

| Assertion | Semantics checked | Typical composables |
| --- | --- | --- |
| `assertIsEnabled()` / `assertIsNotEnabled()` | `Disabled` absent / present | `Button(enabled = …)`, any `clickable(enabled = …)` |
| `assertIsOn()` / `assertIsOff()` | `ToggleableState.On` / `Off` | `Switch`, `Checkbox`, `Modifier.toggleable` |
| `assertIsToggleable()` | Has a `ToggleableState` | Same |
| `assertIsSelected()` / `assertIsNotSelected()` | `Selected = true / false` | `Tab`, `RadioButton`, `FilterChip`, `Modifier.selectable` |
| `assertIsSelectable()` | Has `Selected` | Same |
| `assertIsFocused()` / `assertIsNotFocused()` | `Focused` | Text fields, focusable elements |
| `assertHasClickAction()` / `assertHasNoClickAction()` | `OnClick` action | Anything clickable |
| `assertRangeInfoEquals(ProgressBarRangeInfo(…))` | Progress / slider range and value | `Slider`, `LinearProgressIndicator` |

```kotlin
import androidx.compose.foundation.layout.Column
import androidx.compose.material3.Checkbox
import androidx.compose.material3.Slider
import androidx.compose.material3.Switch
import androidx.compose.material3.Tab
import androidx.compose.material3.PrimaryTabRow
import androidx.compose.material3.Text
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.ProgressBarRangeInfo
import androidx.compose.ui.test.assertIsNotSelected
import androidx.compose.ui.test.assertIsOff
import androidx.compose.ui.test.assertIsOn
import androidx.compose.ui.test.assertIsSelected
import androidx.compose.ui.test.assertRangeInfoEquals
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

@RunWith(RobolectricTestRunner::class)
class StateAssertionsTest {
    @get:Rule
    val composeTestRule = createComposeRule()

    @Test
    fun controlsExposeTheirState() {
        composeTestRule.setContent {
            var wifi by remember { mutableStateOf(false) }
            var agreed by remember { mutableStateOf(true) }
            var tab by remember { mutableIntStateOf(0) }
            Column {
                Switch(checked = wifi, onCheckedChange = { wifi = it }, modifier = Modifier.testTag("wifi"))
                Checkbox(checked = agreed, onCheckedChange = { agreed = it }, modifier = Modifier.testTag("terms"))
                PrimaryTabRow(selectedTabIndex = tab) {
                    listOf("Inbox", "Sent").forEachIndexed { index, title ->
                        Tab(selected = tab == index, onClick = { tab = index }, text = { Text(title) })
                    }
                }
                Slider(value = 0.25f, onValueChange = {}, modifier = Modifier.testTag("volume"))
            }
        }

        composeTestRule.onNodeWithTag("wifi").performClick()
        composeTestRule.onNodeWithText("Sent").performClick()

        composeTestRule.onNodeWithTag("wifi").assertIsOn()
        composeTestRule.onNodeWithTag("terms").assertIsOn()
        composeTestRule.onNodeWithText("Sent").assertIsSelected()
        composeTestRule.onNodeWithText("Inbox").assertIsNotSelected()
        composeTestRule.onNodeWithTag("volume").assertRangeInfoEquals(ProgressBarRangeInfo(0.25f, 0f..1f))
    }

    @Test
    fun switch_startsOff() {
        composeTestRule.setContent {
            Switch(checked = false, onCheckedChange = {}, modifier = Modifier.testTag("wifi"))
        }

        composeTestRule.onNodeWithTag("wifi").assertIsOff()
    }
}
```

A `Switch` or `Checkbox` next to a separate `Text` label has no text of its own, which is why the example tags them. Give real screens a row that merges label and control (`Modifier.toggleable` on the `Row`), and then find it by the label ([accessibility.md](../testing-patterns/accessibility.md)).

## assert(matcher) and expectValue

`assert(matcher)` checks any `SemanticsMatcher` against the node, so every `hasX`/`isX` matcher from [finders-semantics.md](finders-semantics.md#matchers-and-combining-them) doubles as an assertion. `SemanticsMatcher.expectValue(key, value)` covers properties with no dedicated assertion, including custom keys.

```kotlin
import androidx.compose.material3.Text
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.assert
import androidx.compose.ui.test.hasClickAction
import androidx.compose.ui.test.isHeading
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

@RunWith(RobolectricTestRunner::class)
class MatcherAssertionsTest {
    @get:Rule
    val composeTestRule = createComposeRule()

    @Test
    fun sectionTitle_isAHeadingWithoutClickAction() {
        composeTestRule.setContent {
            Text("Settings", Modifier.semantics { heading() })
        }

        composeTestRule.onNodeWithText("Settings")
            .assert(isHeading())
            .assert(!hasClickAction())
            .assert(SemanticsMatcher.keyNotDefined(SemanticsProperties.Role))
    }

    @Test
    fun customLink_hasButtonRole() {
        composeTestRule.setContent {
            Text("Learn more", Modifier.semantics { role = Role.Button })
        }

        composeTestRule.onNodeWithText("Learn more")
            .assert(SemanticsMatcher.expectValue(SemanticsProperties.Role, Role.Button)) { "Learn more should read as a button" }
    }
}
```

The optional trailing lambda adds a message to the failure.

## Collections

`onAllNodes…` returns a `SemanticsNodeInteractionCollection`:

| Assertion | Passes when |
| --- | --- |
| `assertCountEquals(n)` | Exactly `n` nodes match. `assertCountEquals(0)` is the collection form of "none" |
| `assertAll(matcher)` | Every node matches (also when there are none) |
| `assertAny(matcher)` | At least one node matches |

```kotlin
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.selection.selectable
import androidx.compose.material3.Text
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.test.assertAll
import androidx.compose.ui.test.assertAny
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.hasClickAction
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.isSelected
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onAllNodesWithTag
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

@RunWith(RobolectricTestRunner::class)
class CollectionAssertionsTest {
    @get:Rule
    val composeTestRule = createComposeRule()

    @Test
    fun sizes_areClickableAndOneIsSelected() {
        val sizes = listOf("S", "M", "L")
        composeTestRule.setContent {
            Column {
                sizes.forEach { size ->
                    Text(size, Modifier.testTag("size").selectable(selected = size == "M", onClick = {}))
                }
            }
        }

        composeTestRule.onAllNodesWithTag("size").assertCountEquals(3)
        composeTestRule.onAllNodesWithTag("size").assertAll(hasClickAction())
        composeTestRule.onAllNodesWithTag("size").assertAny(hasText("M") and isSelected())
    }
}
```

Do not use `assertAll` alone to check a list is correct: an empty list passes it. Pair it with `assertCountEquals`.

## Size and Position

Bounds assertions take `Dp` and compare with a small tolerance.

| Assertion | Checks |
| --- | --- |
| `assertWidthIsEqualTo(dp)`, `assertHeightIsEqualTo(dp)` | Layout size |
| `assertWidthIsAtLeast(dp)`, `assertHeightIsAtLeast(dp)` | Minimum size |
| `assertTouchWidthIsEqualTo(dp)`, `assertTouchHeightIsEqualTo(dp)` | Touch target, which Material enlarges to 48dp for small controls |
| `assertPositionInRootIsEqualTo(left, top)`, `assertLeftPositionInRootIsEqualTo`, `assertTopPositionInRootIsEqualTo` | Position relative to the root |
| `getBoundsInRoot()`, `getUnclippedBoundsInRoot()` | Return a `DpRect` for custom checks |

```kotlin
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.test.assertHeightIsEqualTo
import androidx.compose.ui.test.assertPositionInRootIsEqualTo
import androidx.compose.ui.test.assertTouchHeightIsEqualTo
import androidx.compose.ui.test.assertTouchWidthIsEqualTo
import androidx.compose.ui.test.assertWidthIsEqualTo
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.unit.dp
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

@RunWith(RobolectricTestRunner::class)
class BoundsTest {
    @get:Rule
    val composeTestRule = createComposeRule()

    @Test
    fun closeButton_hasA48dpTouchTarget() {
        composeTestRule.setContent {
            IconButton(onClick = {}) { Icon(Icons.Filled.Close, contentDescription = "Close") }
        }

        composeTestRule.onNodeWithContentDescription("Close")
            .assertWidthIsEqualTo(40.dp)
            .assertTouchWidthIsEqualTo(48.dp)
            .assertTouchHeightIsEqualTo(48.dp)
    }

    @Test
    fun avatar_isPlacedAfterPadding() {
        composeTestRule.setContent {
            Box(Modifier.padding(start = 16.dp, top = 8.dp).size(40.dp).testTag("avatar"))
        }

        composeTestRule.onNodeWithTag("avatar")
            .assertWidthIsEqualTo(40.dp)
            .assertHeightIsEqualTo(40.dp)
            .assertPositionInRootIsEqualTo(16.dp, 8.dp)
    }
}
```

Under Robolectric's default `LEGACY` graphics mode, text is not really measured: a `Text` node can report a width of about 1px. Assert sizes of things with explicit sizes (or minimum-size rules such as touch targets), not of text-dependent layouts, and check visual layout with screenshot tests under `NATIVE` graphics ([screenshot-testing.md](../testing-patterns/screenshot-testing.md)).

## Asserting Outcomes Outside the UI

Many behaviors end outside the UI: a callback fired, a repository saved, a navigation event emitted. Assert those on what the composable was given, not on its internals.

```kotlin
import androidx.compose.foundation.layout.Column
import androidx.compose.material3.Button
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import com.google.common.truth.Truth.assertThat
import kotlinx.coroutines.launch
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

interface DraftStore {
    suspend fun save(text: String)
}

class FakeDraftStore : DraftStore {
    val saved = mutableListOf<String>()
    override suspend fun save(text: String) {
        saved += text
    }
}

@Composable
fun DraftActions(draft: String, store: DraftStore, onDiscard: () -> Unit) {
    val scope = rememberCoroutineScope()
    Column {
        Button(onClick = { scope.launch { store.save(draft) } }) { Text("Save draft") }
        Button(onClick = onDiscard) { Text("Discard") }
    }
}

@RunWith(RobolectricTestRunner::class)
class DraftActionsTest {
    @get:Rule
    val composeTestRule = createComposeRule()

    @Test
    fun saveDraft_storesTheDraft() {
        val store = FakeDraftStore()
        composeTestRule.setContent { DraftActions("Hello", store, onDiscard = {}) }

        composeTestRule.onNodeWithText("Save draft").performClick()

        composeTestRule.runOnIdle { assertThat(store.saved).containsExactly("Hello") }
    }

    @Test
    fun discard_callsOnDiscardOnce() {
        var discards = 0
        composeTestRule.setContent { DraftActions("Hello", FakeDraftStore(), onDiscard = { discards++ }) }

        composeTestRule.onNodeWithText("Discard").performClick()

        assertThat(discards).isEqualTo(1)
    }
}
```

- Prefer fakes that record calls over mocks ([when-to-mock.md](../architecture/when-to-mock.md), [test-data.md](test-data.md)).
- Work launched from a click runs on the test dispatcher. `runOnIdle { }` waits for Compose to be idle, then runs the block on the UI thread, so the coroutine has run before the check. Work with `delay` or on other dispatchers needs more ([synchronization.md](synchronization.md)).
- When both the UI and a side effect matter, assert both, UI first: it is what the user experiences.

## Reading Values for Other Assertion Libraries

For checks the built-ins do not cover, fetch the node and read its `SemanticsConfiguration`, then assert with Truth or JUnit:

```kotlin snippet
val node = composeTestRule.onNodeWithTag("price").fetchSemanticsNode()
val text = node.config[SemanticsProperties.Text].joinToString { it.text }
assertThat(text).matches("""€\d+\.\d{2}""")
```

`fetchSemanticsNode()` synchronizes like an assertion and fails if the finder does not match exactly one node. Prefer a `SemanticsMatcher` when you can, because its failure message includes the tree.

## Anti-Patterns to Avoid

| Anti-Pattern | Problem | Solution |
| --- | --- | --- |
| `assertExists()` for "the user sees it" | Passes for off-screen content | `assertIsDisplayed()` |
| `assertIsNotDisplayed()` for "it's gone" | Passes even when the finder matches nothing (typos too) | `assertDoesNotExist()` |
| `assertAll(…)` without a count | Passes on an empty collection | Add `assertCountEquals(n)` |
| Asserting immediately after triggering a `delay` or background work | Assertions synchronize once; they do not poll | `waitUntil…` first ([synchronization.md](synchronization.md)) |
| `assertTextEquals` on a node with labels you do not control | Breaks when a label or suffix changes | `assertTextContains` on the value under test |
| Text width or position assertions under `LEGACY` graphics | Text is not really measured | Assert explicit sizes; screenshot tests for layout |
| Reading `remember`ed state or ViewModel internals to assert | Tests implementation, not behavior | Assert rendered nodes and fakes' recorded calls |
| `fetchSemanticsNode().config[...]` everywhere | Poorer failure messages | Matchers and `assert(matcher)` |

## Related References

- **Finders and matchers**: [finders-semantics.md](finders-semantics.md)
- **Waiting before asserting**: [synchronization.md](synchronization.md)
- **Actions that change state**: [actions-gestures.md](actions-gestures.md)
- **Fakes**: [test-data.md](test-data.md), [when-to-mock.md](../architecture/when-to-mock.md)
- **Pixels and visual layout**: [screenshot-testing.md](../testing-patterns/screenshot-testing.md)
- **Accessibility assertions**: [accessibility.md](../testing-patterns/accessibility.md)
