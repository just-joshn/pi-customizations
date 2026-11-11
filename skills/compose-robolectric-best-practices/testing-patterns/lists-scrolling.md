# Lazy Lists and Scrolling

## Table of Contents

1. [How Lazy Lists Look to a Test](#how-lazy-lists-look-to-a-test)
2. [Finding the List](#finding-the-list)
3. [Scrolling to an Item](#scrolling-to-an-item)
4. [Asserting Items and Counts](#asserting-items-and-counts)
5. [Children of a List](#children-of-a-list)
6. [Gestures: Swipe and Fling](#gestures-swipe-and-fling)
7. [Grids and Rows](#grids-and-rows)
8. [Load More at the End of the List](#load-more-at-the-end-of-the-list)
9. [Non-Lazy Scrollable Content](#non-lazy-scrollable-content)
10. [Anti-Patterns](#anti-patterns)

## How Lazy Lists Look to a Test

`LazyColumn`, `LazyRow`, and the lazy grids compose only the items near the viewport. An item that was never composed has **no semantics node**, so a finder cannot see it. That changes how you write assertions:

| You want to check | Use |
| --- | --- |
| An item the user can see now | `onNodeWithText("Item 3").assertIsDisplayed()` |
| An item further down | Scroll first (`performScrollToIndex`, `performScrollToKey`, `performScrollToNode`), then assert |
| An item is gone from the data | Scroll to where it would be, then `assertDoesNotExist()` |
| How many items the list holds | The list's `CollectionInfo`, or scroll to the last index; not `onAllNodes(...).assertCountEquals(n)` |

Robolectric's default device is small (320 × 470 dp), so lists overflow quickly. Set a size with `@Config(qualifiers = ...)` when a test depends on how many rows fit (see [setup-configuration.md](../core/setup-configuration.md)).

## Finding the List

The scroll actions run on the scrollable container, not on an item. Find it by a `testTag` on the list, or by its scroll semantics when the screen has only one scrollable node.

| Matcher | Matches |
| --- | --- |
| `hasScrollAction()` | Any node that can scroll (lazy or `verticalScroll`) |
| `hasScrollToIndexAction()` | Lazy lists and grids (`performScrollToIndex`) |
| `hasScrollToKeyAction()` | Lazy lists and grids (`performScrollToKey`) |
| `hasScrollToNodeAction()` | Nodes that support `performScrollToNode` |

A tag on the `LazyColumn` modifier is the clearest contract when a screen has several scrollable areas (a horizontal carousel inside a vertical feed).

## Scrolling to an Item

```kotlin
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.hasScrollToIndexAction
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performScrollToIndex
import androidx.compose.ui.test.performScrollToKey
import androidx.compose.ui.test.performScrollToNode
import androidx.compose.ui.unit.dp
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

data class Contact(val id: String, val name: String)

@Composable
fun ContactList(contacts: List<Contact>) {
    LazyColumn(Modifier.testTag("contacts")) {
        items(contacts, key = { it.id }) { contact ->
            Text(contact.name, Modifier.fillMaxWidth().height(56.dp))
        }
    }
}

@RunWith(RobolectricTestRunner::class)
class ContactListTest {
    @get:Rule val composeTestRule = createComposeRule()

    private val contacts = List(100) { Contact(id = "c$it", name = "Contact $it") }

    @Test
    fun scrollsToAnIndex() {
        composeTestRule.setContent { ContactList(contacts) }

        composeTestRule.onNodeWithTag("contacts").performScrollToIndex(80)

        composeTestRule.onNodeWithText("Contact 80").assertIsDisplayed()
    }

    @Test
    fun scrollsToAKey() {
        composeTestRule.setContent { ContactList(contacts) }

        composeTestRule.onNodeWithTag("contacts").performScrollToKey("c42")

        composeTestRule.onNodeWithText("Contact 42").assertIsDisplayed()
    }

    @Test
    fun scrollsUntilAMatchingItemIsVisible() {
        composeTestRule.setContent { ContactList(contacts) }

        composeTestRule.onNode(hasScrollToIndexAction())
            .performScrollToNode(hasText("Contact 97"))

        composeTestRule.onNodeWithText("Contact 97").assertIsDisplayed()
    }
}
```

| Action | Needs | Use when |
| --- | --- | --- |
| `performScrollToIndex(i)` | A lazy list or grid | The test knows the position |
| `performScrollToKey(key)` | Items declared with `key = ...` | Position depends on sorting or inserts; keys are stable |
| `performScrollToNode(matcher)` | A scrollable container | You know what the user looks for, not where it is |
| `performScrollTo()` (on the item) | The item already exists in the tree | Non-lazy `Column` with `verticalScroll`; useless for an uncomposed lazy item |

`performScrollToNode` scrolls a lazy list item by item until the matcher finds a node, so it reaches items that were not composed when the call started. Prefer it in tests that describe user intent ("find the row for Ada"); prefer `performScrollToKey` when the test is about a specific record.

## Asserting Items and Counts

Count the data, not the nodes. `onAllNodes(...)` sees only composed items, so the count changes with screen size, item height, and prefetch.

```kotlin
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.assert
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performScrollToIndex
import androidx.compose.ui.unit.dp
import com.google.common.truth.Truth.assertThat
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

@Composable
fun Inbox(subjects: List<String>) {
    LazyColumn(Modifier.testTag("inbox")) {
        items(subjects) { Text(it, Modifier.height(72.dp)) }
    }
}

@RunWith(RobolectricTestRunner::class)
class InboxTest {
    @get:Rule val composeTestRule = createComposeRule()

    private val subjects = List(50) { "Message $it" }

    @Test
    fun onlyNearbyItemsAreComposed() {
        composeTestRule.setContent { Inbox(subjects) }

        val composed = composeTestRule.onAllNodesWithText("Message", substring = true)
            .fetchSemanticsNodes().size
        assertThat(composed).isLessThan(subjects.size)
        composeTestRule.onNodeWithText("Message 49").assertDoesNotExist()
    }

    @Test
    fun lastItemIsReachable() {
        composeTestRule.setContent { Inbox(subjects) }

        composeTestRule.onNodeWithTag("inbox").performScrollToIndex(subjects.lastIndex)

        composeTestRule.onNodeWithText("Message 49").assertIsDisplayed()
    }

    @Test
    fun listReportsItsSizeToAccessibility() {
        composeTestRule.setContent { Inbox(subjects) }

        val hasRows = SemanticsMatcher("has ${subjects.size} rows") {
            it.config.getOrElseNullable(SemanticsProperties.CollectionInfo) { null }?.rowCount == subjects.size
        }
        composeTestRule.onNodeWithTag("inbox").assert(hasRows)
    }
}
```

The list node itself knows the total: lazy lists set the `CollectionInfo` semantics property (what TalkBack uses to announce "item 3 of 50"). With the pinned stack a 50-item `LazyColumn` reported `rowCount = 50`, `columnCount = 1`. The third test asserts it with a custom `SemanticsMatcher`.

The first test documents the trap, not a pattern to copy: "Message 49" is in the data but does not exist in the tree until the list scrolls to it. To prove an item was removed, scroll to where it was and assert `assertDoesNotExist()`, or assert on the neighbouring items that moved up.

## Children of a List

`onChildren()` and `onChildAt(i)` return the list's **composed** children in layout order. They help when items have no unique text (two rows both labelled "Untitled"), but the index is relative to what is composed, not to the data, once the list has scrolled.

```kotlin
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Text
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.test.assertTextEquals
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onChildAt
import androidx.compose.ui.test.onChildren
import androidx.compose.ui.test.onFirst
import androidx.compose.ui.test.onNodeWithTag
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

@RunWith(RobolectricTestRunner::class)
class ChildOrderTest {
    @get:Rule val composeTestRule = createComposeRule()

    @Test
    fun itemsAreSortedByName() {
        val names = listOf("Ada", "Grace", "Linus")
        composeTestRule.setContent {
            LazyColumn(Modifier.testTag("people")) {
                items(names.sortedDescending()) { Text(it) }
            }
        }

        val list = composeTestRule.onNodeWithTag("people")
        list.onChildren().onFirst().assertTextEquals("Linus")
        list.onChildAt(2).assertTextEquals("Ada")
    }
}
```

When each row is a composite (avatar, title, subtitle), give the row `Modifier.semantics(mergeDescendants = true) {}` or make it clickable so the row is one node; otherwise `onChildren()` returns the parts. See [finders-semantics.md](../core/finders-semantics.md) for merged and unmerged trees.

## Gestures: Swipe and Fling

Use the scroll actions to reach an item. Use gestures when the gesture itself is the behavior: pull-to-refresh, a "scroll to top" button that appears after scrolling, a collapsing toolbar.

```kotlin
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.material3.Button
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTouchInput
import androidx.compose.ui.test.swipeUp
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.launch
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

@Composable
fun Feed() {
    val state = rememberLazyListState()
    val scope = rememberCoroutineScope()
    val scrolled by remember { derivedStateOf { state.firstVisibleItemIndex > 0 } }
    Box {
        LazyColumn(state = state, modifier = Modifier.testTag("feed")) {
            items(100) { Text("Post $it", Modifier.height(80.dp)) }
        }
        if (scrolled) {
            Button(onClick = { scope.launch { state.scrollToItem(0) } }) { Text("Back to top") }
        }
    }
}

@RunWith(RobolectricTestRunner::class)
class FeedTest {
    @get:Rule val composeTestRule = createComposeRule()

    @Test
    fun backToTopAppearsAfterScrollingAndReturnsToTheFirstPost() {
        composeTestRule.setContent { Feed() }
        composeTestRule.onNodeWithText("Back to top").assertDoesNotExist()

        composeTestRule.onNodeWithTag("feed").performTouchInput { swipeUp() }

        composeTestRule.onNodeWithText("Back to top").performClick()
        composeTestRule.onNodeWithText("Post 0").assertIsDisplayed()
        composeTestRule.onNodeWithText("Back to top").assertDoesNotExist()
    }
}
```

A swipe ends in a fling, and the fling animation runs on the test clock; the next finder waits for it to settle. Don't assert an exact item index after a swipe: fling distance depends on gesture velocity and screen density. Assert a consequence instead ("Back to top" exists, "Post 0" is not displayed). See [actions-gestures.md](../core/actions-gestures.md) for swipe parameters.

## Grids and Rows

`LazyVerticalGrid`, `LazyHorizontalGrid`, `LazyRow`, and the staggered grids expose the same scroll semantics, so the same actions apply. In a nested layout, scroll the right container: tag the inner `LazyRow` and call `performScrollToIndex` on it.

```kotlin
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.material3.Text
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performScrollToIndex
import androidx.compose.ui.unit.dp
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

@RunWith(RobolectricTestRunner::class)
class GridAndRowTest {
    @get:Rule val composeTestRule = createComposeRule()

    @Test
    fun scrollsAGrid() {
        composeTestRule.setContent {
            LazyVerticalGrid(GridCells.Fixed(3), Modifier.testTag("photos")) {
                items(90) { Text("Photo $it", Modifier.size(100.dp)) }
            }
        }

        composeTestRule.onNodeWithTag("photos").performScrollToIndex(88)

        composeTestRule.onNodeWithText("Photo 88").assertIsDisplayed()
    }

    @Test
    fun scrollsTheRowInsideAFeed() {
        composeTestRule.setContent {
            LazyColumn {
                item {
                    LazyRow(Modifier.testTag("carousel")) {
                        items(20) { Text("Card $it", Modifier.size(200.dp)) }
                    }
                }
                items(20) { Text("Row $it", Modifier.size(80.dp)) }
            }
        }

        composeTestRule.onNodeWithTag("carousel").performScrollToIndex(15)

        composeTestRule.onNodeWithText("Card 15").assertIsDisplayed()
    }
}
```

## Load More at the End of the List

Paging UIs usually load the next page when the last visible index nears the end. Drive the real trigger by scrolling, and back the screen with a fake source the test controls (see [test-data.md](../core/test-data.md)).

```kotlin
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performScrollToIndex
import androidx.compose.ui.unit.dp
import com.google.common.truth.Truth.assertThat
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.filter
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

class FakePager(private val pageSize: Int = 20) {
    val items = mutableStateListOf<String>()
    var requests = 0
        private set

    fun loadNext() {
        requests++
        val start = items.size
        items += List(pageSize) { "Order ${start + it}" }
    }
}

@Composable
fun OrderHistory(pager: FakePager) {
    val state = rememberLazyListState()
    LaunchedEffect(state) {
        snapshotFlow { state.layoutInfo.visibleItemsInfo.lastOrNull()?.index }
            .distinctUntilChanged()
            .filter { last -> last == null || last >= pager.items.size - 3 }
            .collect { pager.loadNext() }
    }
    LazyColumn(state = state, modifier = Modifier.testTag("orders")) {
        items(pager.items) { Text(it, Modifier.height(64.dp)) }
    }
}

@RunWith(RobolectricTestRunner::class)
class OrderHistoryTest {
    @get:Rule val composeTestRule = createComposeRule()

    @Test
    fun scrollingToTheEndLoadsTheNextPage() {
        val pager = FakePager()
        composeTestRule.setContent { OrderHistory(pager) }
        composeTestRule.onNodeWithText("Order 0").assertIsDisplayed()

        composeTestRule.onNodeWithTag("orders").performScrollToIndex(19)

        composeTestRule.onNodeWithTag("orders").performScrollToIndex(25)
        composeTestRule.onNodeWithText("Order 25").assertIsDisplayed()
        assertThat(pager.requests).isEqualTo(2)
    }
}
```

The test asserts the user-visible result (the 26th order shows up) and the request count, which is part of the screen's contract with its data source. If the next page loads asynchronously, the finder after the scroll waits for the composition to go idle; if the fake suspends, release it and let the finder wait (see [synchronization.md](../core/synchronization.md)).

## Non-Lazy Scrollable Content

A `Column` with `Modifier.verticalScroll` composes every child, so every node exists. Call `performScrollTo()` on the target node before an action or `assertIsDisplayed()`: a node below the fold exists but is not displayed.

```kotlin
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
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
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.unit.dp
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

@RunWith(RobolectricTestRunner::class)
class TermsTest {
    @get:Rule val composeTestRule = createComposeRule()

    @Test
    fun acceptButtonIsBelowTheFold() {
        composeTestRule.setContent {
            var accepted by remember { mutableStateOf(false) }
            Column(Modifier.verticalScroll(rememberScrollState())) {
                repeat(30) { Text("Clause $it", Modifier.height(48.dp)) }
                Button(onClick = { accepted = true }) { Text(if (accepted) "Accepted" else "Accept") }
            }
        }
        composeTestRule.onNodeWithText("Accept").assertIsNotDisplayed()

        composeTestRule.onNodeWithText("Accept").performScrollTo().performClick()

        composeTestRule.onNodeWithText("Accepted").assertIsDisplayed()
    }
}
```

Scroll before acting on a node below the fold, so the click lands where the user could tap.

## Anti-Patterns

| Anti-Pattern | Problem | Solution |
| --- | --- | --- |
| `onAllNodesWithTag("row").assertCountEquals(100)` on a lazy list | Only composed rows exist; the count depends on screen size | Assert on the data, or scroll to the last index and assert it |
| `onNodeWithText("Item 80").performScrollTo()` in a `LazyColumn` | The node does not exist yet, so the finder fails | `performScrollToIndex`, `performScrollToKey`, or `performScrollToNode` on the list |
| Repeated `swipeUp()` until an item shows up | Slow, depends on fling distance and density | One scroll action on the list |
| Asserting an exact first-visible index after a swipe | Fling distance varies | Assert a visible consequence |
| `onChildAt(i)` as the data index after scrolling | Child order covers composed items only | Find by text or key |
| Missing `key` on items whose order changes | `performScrollToKey` unusable; state jumps between rows | Stable keys from the model's id |
| Asserting a below-the-fold node in a `verticalScroll` column without scrolling | Node exists but `assertIsDisplayed()` fails | `performScrollTo()` first |

## Related References

- **Finders, merged vs unmerged trees**: [finders-semantics.md](../core/finders-semantics.md)
- **Swipes and touch input**: [actions-gestures.md](../core/actions-gestures.md)
- **Waiting for pages that load asynchronously**: [synchronization.md](../core/synchronization.md)
- **Screen size and qualifiers**: [configuration-changes.md](configuration-changes.md), [setup-configuration.md](../core/setup-configuration.md)
- **Fake data sources**: [test-data.md](../core/test-data.md)
