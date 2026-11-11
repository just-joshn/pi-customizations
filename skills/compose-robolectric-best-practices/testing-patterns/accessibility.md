# Accessibility

## Table of Contents

1. [Semantics Are the Accessibility Contract](#semantics-are-the-accessibility-contract)
2. [Labels: contentDescription and Merged Text](#labels-contentdescription-and-merged-text)
3. [Roles, States, and Headings](#roles-states-and-headings)
4. [Merging and Clearing Semantics](#merging-and-clearing-semantics)
5. [Custom Actions](#custom-actions)
6. [Touch Target Size](#touch-target-size)
7. [Accessibility Test Framework Checks](#accessibility-test-framework-checks)
8. [Anti-Patterns](#anti-patterns)

## Semantics Are the Accessibility Contract

TalkBack, Switch Access, and Compose tests read the same semantics tree. A test that finds a button by its content description and checks its role and state is also checking what a screen reader announces. Write those assertions for the parts of a screen that matter to assistive technology users: icon-only buttons, toggles, headings, list rows, error messages.

| User hears / does | Semantics | Test |
| --- | --- | --- |
| "Delete, button" | `contentDescription`, `Role.Button` | `onNodeWithContentDescription("Delete")`, role matcher |
| "Wi-Fi, switch, on" | `Role.Switch`, `ToggleableState` | `assertIsOn()`, `assertIsToggleable()` |
| "Downloading, 40 percent" | `ProgressBarRangeInfo`, `stateDescription` | `assertRangeInfoEquals`, `hasStateDescription` |
| Jumps between headings | `heading()` | `isHeading()` |
| "Selected" in a tab row | `selected` | `assertIsSelected()` |
| Double-tap and hold actions | `customActions` | `performCustomAccessibilityActionWithLabel` |

Robolectric runs no accessibility service, so these tests check the tree, not a real TalkBack session. Keep a manual pass with TalkBack for flows that matter.

## Labels: contentDescription and Merged Text

Every actionable element needs a label. Text children of a clickable element merge into it, so a `Button { Text("Save") }` is labelled "Save" with no extra work. Icon-only controls need `contentDescription`; decorative images pass `contentDescription = null` so they are skipped.

```kotlin
import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.Row
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Favorite
import androidx.compose.material.icons.filled.Star
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.vector.rememberVectorPainter
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.assert
import androidx.compose.ui.test.assertHasClickAction
import androidx.compose.ui.test.hasContentDescription
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onAllNodesWithContentDescription
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.assertCountEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

@Composable
fun SongRow() {
    Row {
        Image(rememberVectorPainter(Icons.Filled.Star), contentDescription = null)
        Text("Clair de Lune")
        IconButton(onClick = {}) {
            Icon(Icons.Filled.Favorite, contentDescription = "Add Clair de Lune to favorites")
        }
    }
}

@RunWith(RobolectricTestRunner::class)
class SongRowA11yTest {
    @get:Rule val composeTestRule = createComposeRule()

    @Test
    fun favoriteButtonHasALabelAndARole() {
        composeTestRule.setContent { SongRow() }

        composeTestRule.onNodeWithContentDescription("Add Clair de Lune to favorites")
            .assertHasClickAction()
            .assert(SemanticsMatcher.expectValue(SemanticsProperties.Role, Role.Button))
    }

    @Test
    fun decorativeImageIsNotAnnounced() {
        composeTestRule.setContent { SongRow() }

        composeTestRule.onAllNodes(SemanticsMatcher.keyIsDefined(SemanticsProperties.ContentDescription))
            .assertCountEquals(1)
        composeTestRule.onAllNodesWithContentDescription("Star").assertCountEquals(0)
        composeTestRule.onNodeWithContentDescription("Add Clair de Lune to favorites")
            .assert(hasContentDescription("favorites", substring = true))
    }
}
```

`IconButton` reports `Role.Button` on its node, and the icon's description merges into it, so one node carries both. Labels that name the target ("Add Clair de Lune to favorites") beat generic ones ("Favorite") when a list repeats the same icon.

## Roles, States, and Headings

Material components set roles and states for you; custom components must set them. Test custom ones explicitly.

```kotlin
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.selection.toggleable
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.ProgressBarRangeInfo
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.test.assert
import androidx.compose.ui.test.assertIsOff
import androidx.compose.ui.test.assertIsOn
import androidx.compose.ui.test.assertRangeInfoEquals
import androidx.compose.ui.test.assertTextEquals
import androidx.compose.ui.test.hasStateDescription
import androidx.compose.ui.test.isHeading
import androidx.compose.ui.test.isToggleable
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

@Composable
fun DownloadSettings(progress: Float) {
    var wifiOnly by remember { mutableStateOf(true) }
    Column {
        Text("Downloads", Modifier.semantics { heading() })
        Row(
            Modifier.toggleable(value = wifiOnly, role = Role.Switch, onValueChange = { wifiOnly = it }),
        ) {
            Text("Wi-Fi only")
            Switch(checked = wifiOnly, onCheckedChange = null)
        }
        LinearProgressIndicator(
            progress = { progress },
            modifier = Modifier.semantics { stateDescription = "${(progress * 100).toInt()} percent" },
        )
    }
}

@RunWith(RobolectricTestRunner::class)
class DownloadSettingsA11yTest {
    @get:Rule val composeTestRule = createComposeRule()

    @Test
    fun sectionTitleIsAHeading() {
        composeTestRule.setContent { DownloadSettings(progress = 0.4f) }

        composeTestRule.onNode(isHeading()).assertTextEquals("Downloads")
    }

    @Test
    fun wholeRowIsOneSwitch() {
        composeTestRule.setContent { DownloadSettings(progress = 0.4f) }

        composeTestRule.onNodeWithText("Wi-Fi only")
            .assert(isToggleable())
            .assertIsOn()
            .performClick()
            .assertIsOff()
    }

    @Test
    fun progressAnnouncesItsValue() {
        composeTestRule.setContent { DownloadSettings(progress = 0.4f) }

        composeTestRule.onNode(hasStateDescription("40 percent"))
            .assertRangeInfoEquals(ProgressBarRangeInfo(0.4f, 0f..1f))
    }
}
```

The `Switch` with `onCheckedChange = null` plus `Modifier.toggleable` on the row is the pattern the Compose accessibility guidance recommends: the row is one target, labelled by its text. `onNodeWithText("Wi-Fi only")` finding a toggleable node proves the merge worked; if the switch handled clicks itself, the text node would not be toggleable.

## Merging and Clearing Semantics

`Modifier.semantics(mergeDescendants = true) {}` (and `clickable`, `toggleable`) merges children into one node, so TalkBack reads a card as one item. `clearAndSetSemantics { }` replaces the children's semantics with what you set, for a summary label. Test the merged tree (the default) for what users hear; use `useUnmergedTree = true` only to reach a child for layout checks (see [finders-semantics.md](../core/finders-semantics.md)).

```kotlin
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.material3.Text
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.test.assertContentDescriptionEquals
import androidx.compose.ui.test.assertTextEquals
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.platform.testTag
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

@RunWith(RobolectricTestRunner::class)
class MergingTest {
    @get:Rule val composeTestRule = createComposeRule()

    @Test
    fun mergedCardReadsAsOneItem() {
        composeTestRule.setContent {
            Column(Modifier.testTag("card").semantics(mergeDescendants = true) {}) {
                Text("Ada Lovelace")
                Text("Online")
            }
        }

        composeTestRule.onNodeWithTag("card").assertTextEquals("Ada Lovelace", "Online")
    }

    @Test
    fun clearedRatingHasOneSummaryLabel() {
        composeTestRule.setContent {
            Row(Modifier.clearAndSetSemantics { contentDescription = "Rated 4 out of 5" }) {
                repeat(4) { Text("★") }
                Text("☆")
            }
        }

        composeTestRule.onNodeWithContentDescription("Rated 4 out of 5")
            .assertContentDescriptionEquals("Rated 4 out of 5")
        composeTestRule.onNodeWithText("★").assertDoesNotExist()
    }
}
```

## Custom Actions

Swipe-to-dismiss and long-press menus are hard to reach with TalkBack. Expose them as custom actions and test that each one exists and works. `performCustomAccessibilityActionWithLabel` is marked `@ExperimentalTestApi` in 1.12.1, so the test opts in.

```kotlin
import androidx.compose.foundation.layout.Column
import androidx.compose.material3.Text
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.CustomAccessibilityAction
import androidx.compose.ui.semantics.customActions
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.test.ExperimentalTestApi
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performCustomAccessibilityActionWithLabel
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

@RunWith(RobolectricTestRunner::class)
class CustomActionTest {
    @get:Rule val composeTestRule = createComposeRule()

    @OptIn(ExperimentalTestApi::class)
    @Test
    fun archiveIsReachableWithoutASwipe() {
        composeTestRule.setContent {
            val mails = remember { mutableStateListOf("Invoice", "Lunch?") }
            Column {
                mails.forEach { subject ->
                    Text(
                        subject,
                        Modifier.semantics {
                            customActions = listOf(
                                CustomAccessibilityAction("Archive") { mails.remove(subject) },
                            )
                        },
                    )
                }
            }
        }

        composeTestRule.onNodeWithText("Invoice").performCustomAccessibilityActionWithLabel("Archive")

        composeTestRule.onNodeWithText("Invoice").assertDoesNotExist()
        composeTestRule.onNodeWithText("Lunch?").assertExists()
    }
}
```

## Touch Target Size

Material components reserve a 48 × 48 dp target with `Modifier.minimumInteractiveComponentSize()`. Compose also expands the pointer hit area of a small clickable node toward the platform's minimum touch target size, and `assertTouchWidthIsEqualTo` / `assertTouchHeightIsEqualTo` measure that expanded area. With the pinned stack a 24 dp clickable `Box` reported 48 dp touch bounds while its layout bounds stayed 24 dp, so a touch-size assertion alone does not prove the control reserves that space.

```kotlin
import androidx.compose.foundation.layout.Row
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.ui.test.assertTouchHeightIsEqualTo
import androidx.compose.ui.test.assertTouchWidthIsEqualTo
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.assertWidthIsEqualTo
import androidx.compose.ui.unit.dp
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

@RunWith(RobolectricTestRunner::class)
class TouchTargetTest {
    @get:Rule val composeTestRule = createComposeRule()

    @Test
    fun closeButtonHasAFullSizeTouchTarget() {
        composeTestRule.setContent {
            Row {
                IconButton(onClick = {}) { Icon(Icons.Filled.Close, contentDescription = "Close") }
            }
        }

        composeTestRule.onNodeWithContentDescription("Close")
            .assertTouchWidthIsEqualTo(48.dp)
            .assertTouchHeightIsEqualTo(48.dp)
            .assertWidthIsEqualTo(40.dp)
    }
}
```

The `IconButton`'s node measures 40 dp (the visual size), and its touch bounds are 48 dp because of the minimum interactive size around it. For a custom clickable, assert its layout size with `assertWidthIsAtLeast` / `assertHeightIsAtLeast` when the design requires a 48 dp control, since its touch bounds will report 48 dp either way.

## Accessibility Test Framework Checks

Compose 1.8 added automated checks from the Accessibility Test Framework (ATF), in the `androidx.compose.ui:ui-test-junit4-accessibility` artifact. The official guide enables them on an `AndroidComposeTestRule` with `enableAccessibilityChecks()`, then runs them with `tryPerformAccessibilityChecks()` or any action. They look for missing labels, low contrast, small touch targets, and traversal order problems.

**Under Robolectric they do not report Compose issues.** With the pinned stack (Compose 1.12.1, Robolectric 4.17, with or without `@GraphicsMode(NATIVE)` and with the shadow `AccessibilityManager` enabled), the guide's failing example (a clickable box with an empty `contentDescription`) passed, while the same ATF validator did flag an unlabelled `ImageButton` View. ATF does not see Compose's virtual accessibility nodes in this environment. Run these checks in instrumented tests on a device or emulator, and rely on the semantics assertions above in Robolectric tests.

The instrumented form, as a compile-only block (it lives under `androidTest/` in a real project):

```kotlin compile-only
import androidx.activity.ComponentActivity
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.test.junit4.accessibility.enableAccessibilityChecks
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.test.tryPerformAccessibilityChecks
import androidx.compose.ui.unit.dp
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class AccessibilityChecksTest {
    @get:Rule val composeTestRule = createAndroidComposeRule<ComponentActivity>()

    @Test
    fun unlabelledButtonFailsTheChecks() {
        composeTestRule.setContent {
            Box(
                Modifier.size(50.dp).background(Color.Gray).clickable {}
                    .semantics { contentDescription = "" },
            )
        }
        composeTestRule.enableAccessibilityChecks()

        composeTestRule.onRoot().tryPerformAccessibilityChecks()
    }
}
```

On a device this test throws for the missing label. Pass a configured `AccessibilityValidator` to `enableAccessibilityChecks(validator)` to change which result types throw. Roborazzi also ships an accessibility-check integration (`roborazzi-accessibility-check`); it is not part of this skill's verified setup.

## Anti-Patterns

| Anti-Pattern | Problem | Solution |
| --- | --- | --- |
| `testTag` on an icon button instead of a `contentDescription` | The test passes; TalkBack says "unlabelled button" | Find by `contentDescription`; the test then requires a label |
| `contentDescription = "Image"` on decorative images | Noise for screen reader users | `contentDescription = null` |
| A `Switch` that handles its own clicks inside a clickable row | Two focus stops; label not attached to the switch | `toggleable` on the row, `onCheckedChange = null` on the switch |
| Asserting with `useUnmergedTree = true` for labels | Checks what TalkBack does not read | Default merged tree |
| Relying on `enableAccessibilityChecks()` in Robolectric tests | Silently finds nothing for Compose | Semantics assertions here; ATF in instrumented tests |
| Only `assertTouchWidthIsEqualTo(48.dp)` for small controls | Touch bounds include Compose's automatic expansion | Also check the layout size reserved for the control |

## Related References

- **Finders, merged and unmerged trees**: [finders-semantics.md](../core/finders-semantics.md)
- **Role, state, and range assertions**: [assertions.md](../core/assertions.md)
- **Labels and errors in text fields**: [forms-text-input.md](forms-text-input.md)
- **Font scale and RTL**: [configuration-changes.md](configuration-changes.md)
- **Instrumented vs Robolectric tests**: [test-architecture.md](../architecture/test-architecture.md)
