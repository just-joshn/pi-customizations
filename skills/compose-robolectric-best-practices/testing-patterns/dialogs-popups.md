# Dialogs, Bottom Sheets, Menus, and Popups

## Table of Contents

1. [Windows and Roots](#windows-and-roots)
2. [Alert Dialogs](#alert-dialogs)
3. [Dismissing with Back](#dismissing-with-back)
4. [Custom Dialogs](#custom-dialogs)
5. [Dropdown Menus](#dropdown-menus)
6. [Modal Bottom Sheets](#modal-bottom-sheets)
7. [Tooltips](#tooltips)
8. [Anti-Patterns](#anti-patterns)

## Windows and Roots

`Dialog`, `AlertDialog`, `ModalBottomSheet`, `Popup`, `DropdownMenu`, and tooltips each render in their own window. The test sees one semantics root per window, and finders search all of them, so `onNodeWithText("Delete")` finds a button inside a dialog without extra work.

| Matcher | Matches |
| --- | --- |
| `isDialog()` | The root of a `Dialog` window (also `AlertDialog`) |
| `isPopup()` | The root of a `Popup` window (also `DropdownMenu`, tooltips) |
| `isRoot()` | Every window's root |
| `hasAnyAncestor(isDialog())` | Nodes inside a dialog, to tell them apart from the same text behind it |

Two consequences:

- `onRoot()` expects exactly one root. With a dialog open it fails with "Expected exactly '1' node but found '2'". Use `onAllNodes(isRoot())`, or `onNode(isDialog())` for the dialog's root.
- The same text can appear behind and inside the dialog ("Delete" on the screen and on the confirm button). Scope the finder with `hasAnyAncestor(isDialog())`.

## Alert Dialogs

```kotlin
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.foundation.layout.Column
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.hasAnyAncestor
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.isDialog
import androidx.compose.ui.test.isRoot
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

@Composable
fun DraftRow() {
    var draft by remember { mutableStateOf<String?>("Quarterly report") }
    var confirming by remember { mutableStateOf(false) }
    Column {
        Text(draft ?: "No drafts")
        if (draft != null) Button(onClick = { confirming = true }) { Text("Delete") }
    }
    if (confirming) {
        AlertDialog(
            onDismissRequest = { confirming = false },
            title = { Text("Delete draft?") },
            confirmButton = {
                TextButton(onClick = { draft = null; confirming = false }) { Text("Delete") }
            },
            dismissButton = { TextButton(onClick = { confirming = false }) { Text("Cancel") } },
        )
    }
}

@RunWith(RobolectricTestRunner::class)
class DeleteDraftTest {
    @get:Rule val composeTestRule = createComposeRule()

    private val confirmDelete = hasText("Delete") and hasAnyAncestor(isDialog())

    @Test
    fun confirmingDeletesTheDraft() {
        composeTestRule.setContent { DraftRow() }

        composeTestRule.onNodeWithText("Delete").performClick()
        composeTestRule.onNodeWithText("Delete draft?").assertIsDisplayed()
        composeTestRule.onAllNodes(isRoot()).assertCountEquals(2)

        composeTestRule.onNode(confirmDelete).performClick()

        composeTestRule.onNode(isDialog()).assertDoesNotExist()
        composeTestRule.onNodeWithText("No drafts").assertIsDisplayed()
    }

    @Test
    fun cancelKeepsTheDraft() {
        composeTestRule.setContent { DraftRow() }

        composeTestRule.onNodeWithText("Delete").performClick()
        composeTestRule.onNodeWithText("Cancel").performClick()

        composeTestRule.onNode(isDialog()).assertDoesNotExist()
        composeTestRule.onNodeWithText("Quarterly report").assertIsDisplayed()
    }
}
```

Once the dialog is open, `onNodeWithText("Delete")` matches two nodes and fails; `confirmDelete` scopes it to the dialog. Assert that the dialog is gone with `onNode(isDialog()).assertDoesNotExist()` rather than a text check, because its title text may also appear on the screen.

## Dismissing with Back

Compose dialogs and sheets handle back in their own window. Under Robolectric, `Espresso.pressBack()` sends the key to the focused window, which is the dialog, so the dialog's `onDismissRequest` runs. Calling the activity's `onBackPressedDispatcher.onBackPressed()` does **not** reach the dialog: with the pinned stack the dialog stayed open.

```kotlin
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.isDialog
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.window.DialogProperties
import androidx.test.espresso.Espresso
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

@RunWith(RobolectricTestRunner::class)
class BackDismissTest {
    @get:Rule val composeTestRule = createComposeRule()

    @Test
    fun backDismissesTheDialog() {
        composeTestRule.setContent {
            var open by remember { mutableStateOf(true) }
            if (open) {
                AlertDialog(
                    onDismissRequest = { open = false },
                    title = { Text("Rate this app") },
                    confirmButton = { TextButton(onClick = { open = false }) { Text("OK") } },
                )
            } else {
                Text("Dismissed")
            }
        }
        composeTestRule.onNode(isDialog()).assertExists()

        Espresso.pressBack()

        composeTestRule.onNode(isDialog()).assertDoesNotExist()
        composeTestRule.onNodeWithText("Dismissed").assertIsDisplayed()
    }

    @Test
    fun backDoesNotDismissABlockingDialog() {
        composeTestRule.setContent {
            AlertDialog(
                onDismissRequest = {},
                title = { Text("Updating") },
                confirmButton = {},
                properties = DialogProperties(dismissOnBackPress = false),
            )
        }

        Espresso.pressBack()

        composeTestRule.onNodeWithText("Updating").assertIsDisplayed()
    }
}
```

Clicking outside a dialog (the scrim) is not something these tests drive: touch input is injected into a node's own window, and a dialog's root covers only the dialog surface. Test the dismiss logic through the back press or the buttons, and keep `dismissOnClickOutside` for an instrumented test if it matters. For back handling on screens and navigation, see [activities-intents.md](activities-intents.md) and [navigation.md](navigation.md).

## Custom Dialogs

A full-screen or custom `Dialog { ... }` behaves the same way. Give its content semantics a user can perceive (a title, labelled buttons) and find by those. Use `isDialog()` only to scope or to prove the window exists.

```kotlin
import androidx.compose.foundation.layout.Column
import androidx.compose.material3.Button
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.hasAnyAncestor
import androidx.compose.ui.test.isDialog
import androidx.compose.ui.test.isHeading
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.performClick
import androidx.compose.ui.window.Dialog
import com.google.common.truth.Truth.assertThat
import androidx.compose.ui.test.onNodeWithText
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

@RunWith(RobolectricTestRunner::class)
class CustomDialogTest {
    @get:Rule val composeTestRule = createComposeRule()

    @Test
    fun titleIsAHeadingInsideTheDialog() {
        var accepted = false
        composeTestRule.setContent {
            Dialog(onDismissRequest = {}) {
                Surface {
                    Column {
                        Text("New terms", Modifier.semantics { heading() })
                        Button(onClick = { accepted = true }) { Text("Accept") }
                    }
                }
            }
        }

        composeTestRule.onNode(isHeading() and hasAnyAncestor(isDialog())).assertIsDisplayed()
        composeTestRule.onNodeWithText("Accept").performClick()

        assertThat(accepted).isTrue()
    }
}
```

## Dropdown Menus

`DropdownMenu` items live in a popup window that exists only while `expanded` is true. Open the menu as the user would, pick an item, and assert the result and that the popup closed.

```kotlin
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.hasAnyAncestor
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.isPopup
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.test.espresso.Espresso
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

@Composable
fun SortMenu() {
    var expanded by remember { mutableStateOf(false) }
    var sort by remember { mutableStateOf("Newest") }
    Column {
        Text("Sorted by $sort")
        Box {
            IconButton(onClick = { expanded = true }) {
                Icon(Icons.Filled.MoreVert, contentDescription = "Sort options")
            }
            DropdownMenu(expanded = expanded, onDismissRequest = { expanded = false }) {
                listOf("Newest", "Oldest", "Name").forEach { option ->
                    DropdownMenuItem(
                        text = { Text(option) },
                        onClick = { sort = option; expanded = false },
                    )
                }
            }
        }
    }
}

@RunWith(RobolectricTestRunner::class)
class SortMenuTest {
    @get:Rule val composeTestRule = createComposeRule()

    @Test
    fun choosingAnOptionAppliesItAndClosesTheMenu() {
        composeTestRule.setContent { SortMenu() }
        composeTestRule.onNode(isPopup()).assertDoesNotExist()

        composeTestRule.onNodeWithContentDescription("Sort options").performClick()
        composeTestRule.onNode(hasText("Name") and hasAnyAncestor(isPopup())).performClick()

        composeTestRule.onNodeWithText("Sorted by Name").assertIsDisplayed()
        composeTestRule.onNode(isPopup()).assertDoesNotExist()
    }

    @Test
    fun backClosesTheMenuWithoutChanging() {
        composeTestRule.setContent { SortMenu() }
        composeTestRule.onNodeWithContentDescription("Sort options").performClick()
        composeTestRule.onNode(isPopup()).assertExists()

        Espresso.pressBack()

        composeTestRule.onNode(isPopup()).assertDoesNotExist()
        composeTestRule.onNodeWithText("Sorted by Newest").assertIsDisplayed()
    }
}
```

Scoping the item with `hasAnyAncestor(isPopup())` keeps the finder correct when the screen behind the menu later shows the same label (a chip reading "Name", for example).

## Modal Bottom Sheets

`ModalBottomSheet` opens in its own window and animates in and out. The animation runs on the test clock, so the finders that follow wait for it. Hide the sheet the way production code does: `sheetState.hide()` then remove it from composition.

```kotlin
import androidx.compose.foundation.layout.Column
import androidx.compose.material3.Button
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.test.espresso.Espresso
import kotlinx.coroutines.launch
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ShareScreen() {
    var showSheet by remember { mutableStateOf(false) }
    var sharedTo by remember { mutableStateOf<String?>(null) }
    val sheetState = rememberModalBottomSheetState()
    val scope = rememberCoroutineScope()
    Column {
        Button(onClick = { showSheet = true }) { Text("Share") }
        sharedTo?.let { Text("Shared to $it") }
    }
    if (showSheet) {
        ModalBottomSheet(onDismissRequest = { showSheet = false }, sheetState = sheetState) {
            listOf("Email", "Messages").forEach { target ->
                TextButton(onClick = {
                    sharedTo = target
                    scope.launch { sheetState.hide() }.invokeOnCompletion { showSheet = false }
                }) { Text(target) }
            }
        }
    }
}

@RunWith(RobolectricTestRunner::class)
class ShareSheetTest {
    @get:Rule val composeTestRule = createComposeRule()

    @Test
    fun pickingATargetSharesAndClosesTheSheet() {
        composeTestRule.setContent { ShareScreen() }

        composeTestRule.onNodeWithText("Share").performClick()
        composeTestRule.onNodeWithText("Messages").performClick()

        composeTestRule.onNodeWithText("Shared to Messages").assertIsDisplayed()
        composeTestRule.onNodeWithText("Email").assertDoesNotExist()
    }

    @Test
    fun backClosesTheSheet() {
        composeTestRule.setContent { ShareScreen() }
        composeTestRule.onNodeWithText("Share").performClick()
        composeTestRule.onNodeWithText("Email").assertIsDisplayed()

        Espresso.pressBack()

        composeTestRule.onNodeWithText("Email").assertDoesNotExist()
    }
}
```

## Tooltips

Material 3 tooltips appear on long press (and on hover or focus) and live in a popup. Long-press the anchor with `performTouchInput { longClick() }`, then find the tooltip text.

```kotlin
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.PlainTooltip
import androidx.compose.material3.Text
import androidx.compose.material3.TooltipAnchorPosition
import androidx.compose.material3.TooltipBox
import androidx.compose.material3.TooltipDefaults
import androidx.compose.material3.rememberTooltipState
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.hasAnyAncestor
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.isPopup
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.longClick
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.performTouchInput
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

@RunWith(RobolectricTestRunner::class)
class TooltipTest {
    @get:Rule val composeTestRule = createComposeRule()

    @OptIn(ExperimentalMaterial3Api::class)
    @Test
    fun longPressShowsTheTooltip() {
        composeTestRule.setContent {
            TooltipBox(
                positionProvider = TooltipDefaults.rememberTooltipPositionProvider(TooltipAnchorPosition.Above),
                tooltip = { PlainTooltip { Text("Add to playlist") } },
                state = rememberTooltipState(),
            ) {
                IconButton(onClick = {}) { Icon(Icons.Filled.Add, contentDescription = "Add") }
            }
        }

        composeTestRule.onNodeWithContentDescription("Add").performTouchInput { longClick() }

        composeTestRule.onNode(hasText("Add to playlist") and hasAnyAncestor(isPopup()))
            .assertIsDisplayed()
    }
}
```

A plain tooltip hides itself after a timeout; the test clock auto-advances, so assert right after the long press and don't add extra waits between the press and the assertion. For timeout behavior, pause the clock as described in [animations-clock.md](animations-clock.md).

## Anti-Patterns

| Anti-Pattern | Problem | Solution |
| --- | --- | --- |
| `onRoot()` with a dialog or popup open | Fails: more than one root | `onAllNodes(isRoot())` or `onNode(isDialog())` |
| `onNodeWithText("Delete")` when the dialog repeats a label | "Expected exactly '1' node but found '2'" | `hasText(...) and hasAnyAncestor(isDialog())` |
| `activity.onBackPressedDispatcher.onBackPressed()` to close a dialog | The dialog's own window handles back; it stays open | `Espresso.pressBack()` |
| Asserting `assertIsNotDisplayed()` after closing | The node no longer exists, so the assertion fails | `assertDoesNotExist()` |
| Setting the sheet's visibility flag without `sheetState.hide()` in the test subject | Sheet vanishes without its exit animation; differs from production | Hide via the state, then drop it from composition |
| `Thread.sleep` waiting for a sheet animation | Real time does not drive the test clock | Rely on finder synchronization; see [synchronization.md](../core/synchronization.md) |

## Related References

- **Finders and matcher composition**: [finders-semantics.md](../core/finders-semantics.md)
- **Long press and touch input**: [actions-gestures.md](../core/actions-gestures.md)
- **Animations and the test clock**: [animations-clock.md](animations-clock.md)
- **Back press on screens and activities**: [activities-intents.md](activities-intents.md)
- **Screenshots of dialogs (`captureScreenRoboImage`)**: [screenshot-testing.md](screenshot-testing.md)
