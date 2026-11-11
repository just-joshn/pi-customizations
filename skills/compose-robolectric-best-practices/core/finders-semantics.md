# Finders and Semantics

## Table of Contents

1. [Tests Read the Semantics Tree](#tests-read-the-semantics-tree)
2. [Finder Priority](#finder-priority)
3. [Convenience Finders](#convenience-finders)
4. [Matchers and Combining Them](#matchers-and-combining-them)
5. [Hierarchy Matchers and Selectors](#hierarchy-matchers-and-selectors)
6. [Multiple Nodes](#multiple-nodes)
7. [Merged vs Unmerged Tree](#merged-vs-unmerged-tree)
8. [testTag](#testtag)
9. [Modifier.semantics](#modifiersemantics)
10. [Custom Semantics Properties](#custom-semantics-properties)
11. [Common Errors](#common-errors)
12. [Anti-Patterns to Avoid](#anti-patterns-to-avoid)

## Tests Read the Semantics Tree

Compose tests do not see composables or pixels. They query the **semantics tree**, the same tree accessibility services read: text, content descriptions, roles, states (enabled, selected, toggled), actions (click, scroll, set text), and test tags. A composable that adds nothing to semantics (a plain `Box` or `Row`) has no node.

So a node is findable when it carries a property the user (or TalkBack) can perceive. If a test cannot find something, check what the tree contains before reaching for a tag: `composeTestRule.onRoot().printToLog("TREE")` ([debugging.md](../debugging/debugging.md)).

## Finder Priority

Prefer what the user perceives. Fall back to test tags only when there is no stable user-facing property.

| Priority | Finder | Use for |
| --- | --- | --- |
| 1 | `onNodeWithText("Sign in")` | Buttons, labels, messages, list items |
| 2 | `onNodeWithContentDescription("Close")` | Icons and images (what TalkBack reads) |
| 3 | `onNode(hasText("Save") and hasClickAction())`, role matchers | Disambiguating nodes that share text |
| 4 | `onNodeWithText(…, useUnmergedTree = true)` | A child inside a merged node (a button's second line) |
| 5 | `onNodeWithTag("cart-total")` | Content with no stable text: dynamic numbers, containers, canvases |

Finding by text also checks that the text exists: a test that finds "Sign in" fails if the label is lost. A test tag survives the label disappearing. For text that comes from string resources, read it from the activity or context rather than hard-coding a translation ([test-structure.md](test-structure.md#createandroidcomposerule)).

## Convenience Finders

| Finder | Matches | Options |
| --- | --- | --- |
| `onNodeWithText(text)` | `Text`, `EditableText` (a text field's value), and labels merged into the node | `substring`, `ignoreCase`, `useUnmergedTree` |
| `onNodeWithContentDescription(label)` | `contentDescription` | `substring`, `ignoreCase`, `useUnmergedTree` |
| `onNodeWithTag(tag)` | `Modifier.testTag(tag)` | `useUnmergedTree` |
| `onNode(matcher)` | Any `SemanticsMatcher` | `useUnmergedTree` |
| `onRoot()` | The root of the tree | `useUnmergedTree` |
| `onAllNodesWithText`, `onAllNodesWithContentDescription`, `onAllNodesWithTag`, `onAllNodes(matcher)` | All matches, as a collection | Same as above |

`onNode…` returns a lazy `SemanticsNodeInteraction`: nothing is looked up until you assert or act on it, and it is looked up again each time. Keeping a reference across a recomposition is fine.

```kotlin
import androidx.compose.foundation.layout.Column
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Text
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

@RunWith(RobolectricTestRunner::class)
class ConvenienceFindersTest {
    @get:Rule
    val composeTestRule = createComposeRule()

    @Test
    fun findsByTextAndContentDescription() {
        var closed = false
        composeTestRule.setContent {
            Column {
                Text("Order #1042 shipped")
                IconButton(onClick = { closed = true }) {
                    Icon(Icons.Filled.Close, contentDescription = "Close")
                }
            }
        }

        composeTestRule.onNodeWithText("#1042", substring = true).assertIsDisplayed()
        composeTestRule.onNodeWithText("ORDER #1042 SHIPPED", ignoreCase = true).assertIsDisplayed()
        composeTestRule.onNodeWithContentDescription("Close").performClick()

        assertTrue(closed)
    }
}
```

With `substring = false` (the default) the whole text must equal the argument. `substring = true` matches a part of it. Both work on each text value of the node, not on the concatenation.

## Matchers and Combining Them

`hasX()` functions return a `SemanticsMatcher`. Pass one to `onNode`, `onAllNodes`, `filter`, `assert`, or the `waitUntil…` helpers. Combine with `and`, `or`, and `!` (or `.not()`).

| Matcher | Matches |
| --- | --- |
| `hasText(text, substring, ignoreCase)`, `hasTextExactly(vararg)` | Text values |
| `hasContentDescription(…)`, `hasContentDescriptionExactly(…)` | Content descriptions |
| `hasTestTag(tag)` | Test tag |
| `hasClickAction()`, `hasNoClickAction()`, `hasScrollAction()`, `hasSetTextAction()`, `hasImeAction(ImeAction.Done)` | Actions |
| `isEnabled()`, `isNotEnabled()`, `isSelected()`, `isNotSelected()`, `isOn()`, `isOff()`, `isToggleable()`, `isSelectable()`, `isFocused()`, `isFocusable()` | States |
| `isHeading()`, `isDialog()`, `isPopup()`, `isEditable()`, `isRoot()` | Kinds of node |
| `hasStateDescription(text)`, `hasProgressBarRangeInfo(info)` | Accessibility state |
| `SemanticsMatcher.expectValue(key, value)`, `keyIsDefined(key)`, `keyNotDefined(key)` | Any semantics property, including custom ones |

There is no `hasRole`. Match a role with `expectValue`:

```kotlin
import androidx.compose.foundation.layout.Column
import androidx.compose.material3.Button
import androidx.compose.material3.Checkbox
import androidx.compose.material3.Text
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.hasClickAction
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.isEnabled
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.assertCountEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

fun hasRole(role: Role) = SemanticsMatcher.expectValue(SemanticsProperties.Role, role)

@RunWith(RobolectricTestRunner::class)
class CombinedMatchersTest {
    @get:Rule
    val composeTestRule = createComposeRule()

    @Test
    fun combinesTextRoleAndState() {
        composeTestRule.setContent {
            Column {
                Text("Delete")
                Button(onClick = {}) { Text("Delete") }
                Button(onClick = {}, enabled = false) { Text("Archive") }
                Checkbox(checked = false, onCheckedChange = {})
            }
        }
        composeTestRule.onAllNodesWithText("Delete").assertCountEquals(2)

        composeTestRule.onNode(hasText("Delete") and hasClickAction()).assertIsDisplayed()
        composeTestRule.onNode(hasText("Delete") and hasRole(Role.Button)).assertIsDisplayed()
        composeTestRule.onNode(hasText("Archive") and !isEnabled()).assertIsDisplayed()
        composeTestRule.onNode(hasRole(Role.Checkbox)).assertIsDisplayed()
    }
}
```

## Hierarchy Matchers and Selectors

Hierarchy matchers match a node by its relatives: `hasParent(m)`, `hasAnyAncestor(m)`, `hasAnyChild(m)`, `hasAnyDescendant(m)`, `hasAnySibling(m)`. Selectors walk from a node you already found: `onParent()`, `onChildren()`, `onChild()`, `onChildAt(i)`, `onSiblings()`, `onSibling()`, `onAncestors()`, and on a collection `filter(m)`, `filterToOne(m)`, `onFirst()`, `onLast()`, `get(i)`.

The usual need is "the button in **this** row" when every row has the same button:

```kotlin
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.isTraversalGroup
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.hasAnyAncestor
import androidx.compose.ui.test.hasAnySibling
import androidx.compose.ui.test.hasClickAction
import androidx.compose.ui.test.hasTestTag
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onChildren
import androidx.compose.ui.test.performClick
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

@Composable
fun Contacts(names: List<String>, onRemove: (String) -> Unit) {
    Column(Modifier.testTag("contacts")) {
        names.forEach { name ->
            Row(Modifier.semantics { isTraversalGroup = true }) {
                Text(name)
                TextButton(onClick = { onRemove(name) }) { Text("Remove") }
            }
        }
    }
}

@RunWith(RobolectricTestRunner::class)
class HierarchyTest {
    @get:Rule
    val composeTestRule = createComposeRule()

    @Test
    fun removeInGracesRow_removesGrace() {
        val removed = mutableListOf<String>()
        composeTestRule.setContent { Contacts(listOf("Ada", "Grace"), onRemove = { removed += it }) }

        composeTestRule
            .onNode(hasText("Remove") and hasAnySibling(hasText("Grace")))
            .performClick()

        assertEquals(listOf("Grace"), removed)
    }

    @Test
    fun containerHasOneButtonPerContact() {
        composeTestRule.setContent { Contacts(listOf("Ada", "Grace", "Linus"), onRemove = {}) }

        composeTestRule.onNodeWithTag("contacts").onChildren().assertCountEquals(3)
        composeTestRule.onAllNodes(hasClickAction() and hasAnyAncestor(hasTestTag("contacts"))).assertCountEquals(3)
    }
}
```

A plain `Row` or `Column` creates no semantics node. Without the `semantics { isTraversalGroup = true }` on each row, every `Text` and button would be a child of the tagged `Column`, so both "Remove" buttons would be siblings of "Grace" and the finder would match two nodes. Giving each row its own node (a traversal group, `Modifier.semantics(mergeDescendants = true)`, or a clickable row) scopes "sibling" to that row. A traversal group also keeps the row's content together in accessibility traversal order.

## Multiple Nodes

`onNode…` expects **exactly one** match. Zero or several fail when you act or assert (except `assertDoesNotExist`). For several:

```kotlin snippet
composeTestRule.onAllNodesWithText("Remove").assertCountEquals(3)
composeTestRule.onAllNodesWithText("Remove").onFirst().performClick()
composeTestRule.onAllNodesWithText("Remove")[1].performClick()
composeTestRule.onAllNodesWithTag("row").filterToOne(hasAnyDescendant(hasText("Grace")))
composeTestRule.onAllNodesWithTag("row").assertAll(hasClickAction())
composeTestRule.onAllNodesWithTag("row").assertAny(isSelected())
```

Prefer narrowing the matcher (by sibling, ancestor, or state) over an index. `onFirst()` and `[1]` depend on order and break when the layout changes. `assertCountEquals`, `assertAll`, and `assertAny` are in [assertions.md](assertions.md#collections).

## Merged vs Unmerged Tree

Some composables **merge** their descendants' semantics into themselves: `Button`, `Checkbox` rows built with `toggleable`, anything `clickable`, and any `Modifier.semantics(mergeDescendants = true)`. Finders search the **merged** tree by default, where a button with two `Text` children is one node whose `Text` is `[Hello, World]`.

```kotlin
import androidx.compose.material3.Button
import androidx.compose.material3.Text
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertTextEquals
import androidx.compose.ui.test.hasClickAction
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

@RunWith(RobolectricTestRunner::class)
class MergedTreeTest {
    @get:Rule
    val composeTestRule = createComposeRule()

    @Test
    fun buttonMergesItsTexts() {
        composeTestRule.setContent {
            Button(onClick = {}) {
                Text("Hello")
                Text("World")
            }
        }

        composeTestRule.onNodeWithText("Hello").assertTextEquals("Hello", "World")
        composeTestRule.onNode(hasText("World") and hasClickAction()).assertIsDisplayed()

        composeTestRule.onNodeWithText("World", useUnmergedTree = true).assertTextEquals("World")
    }
}
```

- In the merged tree, `onNodeWithText("Hello")` returns the **button** (it has a click action), because "Hello" is one of its text values.
- `useUnmergedTree = true` returns the child `Text` node itself. Use it to check one child's own properties, or when a `testTag` sits on a child inside a merging parent.
- Actions (`performClick`) belong on the merged node, which owns the click action.
- Nodes cleared with `Modifier.clearAndSetSemantics { … }` expose only what the block sets, in both trees. If a child's text vanished from the tree, look for it.

## testTag

`Modifier.testTag("id")` adds a tag only tests read. Use it for what has no stable user-facing property, and keep tags stable and descriptive.

```kotlin
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.material3.Button
import androidx.compose.material3.Text
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertTextEquals
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.unit.dp
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

@RunWith(RobolectricTestRunner::class)
class TestTagTest {
    @get:Rule
    val composeTestRule = createComposeRule()

    @Test
    fun tagsFindContainersAndChildren() {
        composeTestRule.setContent {
            Box(Modifier.size(100.dp).testTag("chart"))
            Button(onClick = {}) { Text("€42.00", Modifier.testTag("total")) }
        }

        composeTestRule.onNodeWithTag("chart").assertIsDisplayed()
        composeTestRule.onNodeWithTag("total", useUnmergedTree = true).assertTextEquals("€42.00")
    }
}
```

- A tag on a child inside a merging parent (the `Text` inside the `Button`) is not in the merged tree as its own node, so finding it needs `useUnmergedTree = true`.
- Define shared tags as constants in main code (`object CartTags { const val TOTAL = "cart-total" }`) so code and tests cannot drift.
- `Modifier.semantics { testTagsAsResourceId = true }` exposes tags to UI Automator as resource IDs. Robolectric tests do not need it.

## Modifier.semantics

When the user-facing property you want to find by is missing, add it to the semantics instead of adding a tag. That fixes accessibility and the test at once ([accessibility.md](../testing-patterns/accessibility.md)).

| You want | Add |
| --- | --- |
| An icon-only control findable by its label | `contentDescription = "Remove from favorites"` (or the `contentDescription` parameter) |
| A custom control treated as a button / switch | `role = Role.Button`, `Modifier.clickable(role = …)`, `Modifier.toggleable(…)` |
| A state read aloud ("Expanded") | `stateDescription = "Expanded"` |
| A section title | `heading()` |
| A row read and clicked as one item | `Modifier.semantics(mergeDescendants = true) { }` or `Modifier.clickable` |
| Hide decorative content | `Modifier.clearAndSetSemantics { }` or `contentDescription = null` on images |

```kotlin
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.test.assert
import androidx.compose.ui.test.hasStateDescription
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.performClick
import androidx.compose.ui.unit.dp
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

@Composable
fun FavoriteToggle() {
    var favorite by remember { mutableStateOf(false) }
    Box(
        Modifier
            .size(48.dp)
            .clickable(role = Role.Button) { favorite = !favorite }
            .semantics {
                contentDescription = "Favorite"
                stateDescription = if (favorite) "On" else "Off"
            },
    )
}

@RunWith(RobolectricTestRunner::class)
class SemanticsModifierTest {
    @get:Rule
    val composeTestRule = createComposeRule()

    @Test
    fun clickingFavorite_turnsItOn() {
        composeTestRule.setContent { FavoriteToggle() }

        composeTestRule.onNodeWithContentDescription("Favorite").performClick()

        composeTestRule.onNodeWithContentDescription("Favorite").assert(hasStateDescription("On"))
    }
}
```

## Custom Semantics Properties

When no standard property describes what a test must check (a date picker's selected epoch day, a map's zoom level), define a `SemanticsPropertyKey`, expose it from the composable, and match it with `SemanticsMatcher.expectValue`. Do not use custom properties to expose visual details such as colors or font sizes: it pollutes production code and is better covered by screenshot tests ([screenshot-testing.md](../testing-patterns/screenshot-testing.md)).

```kotlin
import androidx.compose.foundation.layout.Column
import androidx.compose.material3.Button
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.SemanticsPropertyKey
import androidx.compose.ui.semantics.SemanticsPropertyReceiver
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.assert
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

val SelectedEpochDay = SemanticsPropertyKey<Long>("SelectedEpochDay")
var SemanticsPropertyReceiver.selectedEpochDay by SelectedEpochDay

@Composable
fun DayStepper(start: Long) {
    var day by remember { mutableLongStateOf(start) }
    Column(Modifier.semantics { selectedEpochDay = day }) {
        Text("Day $day")
        Button(onClick = { day++ }) { Text("Next day") }
    }
}

fun hasSelectedEpochDay(day: Long) = SemanticsMatcher.expectValue(SelectedEpochDay, day)

fun isAfterEpochDay(day: Long) = SemanticsMatcher("${SelectedEpochDay.name} > $day") { node ->
    node.config.getOrElseNullable(SelectedEpochDay) { null }?.let { it > day } ?: false
}

@RunWith(RobolectricTestRunner::class)
class CustomPropertyTest {
    @get:Rule
    val composeTestRule = createComposeRule()

    @Test
    fun nextDay_advancesSelectedDay() {
        composeTestRule.setContent { DayStepper(start = 20_000) }

        composeTestRule.onNodeWithText("Next day").performClick()

        composeTestRule.onNode(hasSelectedEpochDay(20_001)).assertExists()
        composeTestRule.onNode(isAfterEpochDay(20_000)).assert(hasSelectedEpochDay(20_001))
    }
}
```

- The `SemanticsMatcher(description) { node -> … }` constructor builds any matcher. The description appears in failure messages, so make it readable.
- Read a property with `node.config.getOrElseNullable(key) { null }` (or `node.config[key]`, which throws when absent).

## Common Errors

| Message (start) | Meaning | Fix |
| --- | --- | --- |
| `Failed: assertExists. Reason: Expected exactly '1' node but could not find any node that satisfies: (Text + InputText + EditableText contains 'X' …)` | No node matches | Print the tree; check merged vs unmerged, exact vs substring, off-screen lazy items ([lists-scrolling.md](../testing-patterns/lists-scrolling.md)) |
| `Assert failed: The component with Text + InputText + EditableText contains 'X' … is not displayed!` | From `assertIsDisplayed()`. Also printed when **no** node matches, not only for an off-screen one | Check with `assertExists()` first; its message says whether the node is missing |
| `Failed to inject touch input. Reason: Expected exactly '1' node but found '2' nodes that satisfy: …` | Ambiguous matcher; the message lists the nodes found | Combine matchers, use a hierarchy matcher, or `onAllNodes` |
| `… could not find any node … (TestTag = 'total')` though the tag is in code | Tag is on a child of a merging parent | `useUnmergedTree = true` |
| Node found, action does nothing | Acting on an unmerged child that has no click action | Act on the merged node |

The messages print the matching or nearby nodes; read them before changing the finder. More in [common-errors.md](../debugging/common-errors.md).

## Anti-Patterns to Avoid

| Anti-Pattern | Problem | Solution |
| --- | --- | --- |
| `testTag` on everything, including labeled buttons | Tests stop checking what users see | Text and content description first; tags for content without stable text |
| `onAllNodesWithText("Remove")[2]` | Breaks when order changes | `hasAnySibling`/`hasAnyAncestor` to pick the right one |
| `useUnmergedTree = true` everywhere | Finds children without actions; misses what TalkBack sees | Default merged tree; unmerged only for a child's own properties |
| Hard-coded English for resource strings | Breaks with locale qualifiers and copy edits | Read the string from the activity or context |
| Custom semantics properties for colors or sizes | Pollutes production semantics | Screenshot tests |
| `substring = true` to dodge dynamic parts | Can match the wrong node | Match the full text, or tag the dynamic part |
| Looking for a node a `Row`/`Box` should create | Layouts without semantics create no node | Find the content, or add semantics that also help accessibility |

## Related References

- **Assertions on found nodes**: [assertions.md](assertions.md)
- **Actions**: [actions-gestures.md](actions-gestures.md)
- **Printing the tree**: [debugging.md](../debugging/debugging.md)
- **Lazy list items that are not composed yet**: [lists-scrolling.md](../testing-patterns/lists-scrolling.md)
- **Accessibility semantics and checks**: [accessibility.md](../testing-patterns/accessibility.md)
- **Waiting for a node to appear**: [synchronization.md](synchronization.md#waituntil-helpers)
