# Configuration Changes

## Table of Contents

1. [Two Tools: Qualifiers and Overrides](#two-tools-qualifiers-and-overrides)
2. [Dark Mode](#dark-mode)
3. [Locale and String Resources](#locale-and-string-resources)
4. [Right-to-Left Layouts](#right-to-left-layouts)
5. [Screen Size and Orientation](#screen-size-and-orientation)
6. [Font Scale](#font-scale)
7. [State Restoration](#state-restoration)
8. [Activity Recreation](#activity-recreation)
9. [Anti-Patterns](#anti-patterns)
10. [Related References](#related-references)

## Two Tools: Qualifiers and Overrides

| | `@Config(qualifiers = …)` / `RuntimeEnvironment.setQualifiers` | `DeviceConfigurationOverride` |
| --- | --- | --- |
| Scope | The whole simulated device: resources, `Configuration`, every window | One composable subtree |
| Set where | Annotation on class or method, or a call before `setContent` | Inside `setContent` |
| Changes resources (`stringResource`) | Yes | `Locales` does (observed); size and direction overrides change layout only |
| Several variants in one test | No | Yes |
| Needs Robolectric | Yes | No; also runs on devices |

`DeviceConfigurationOverride` overrides in ui-test 1.12.1: `DarkMode`, `FontScale`, `FontWeightAdjustment`, `ForcedSize`, `Keyboard`, `LayoutDirection`, `Locales`, `Navigation`, `RoundScreen`, `Touchscreen`, `UiMode`, `WindowInsets`, `WindowSize`. Combine them with `then`.

Use qualifiers when the test is about the device (an activity, resource selection, `Configuration` read outside Compose). Use overrides to test one component in several configurations. Qualifier syntax and the default device (`w320dp-h470dp`, `mdpi`, `en-rUS`) are in [setup-configuration.md](../core/setup-configuration.md#qualifiers-and-the-default-device).

## Dark Mode

Test the behavior that depends on the theme, not the colors: a different icon, label, or illustration. Colors belong in screenshot tests ([screenshot-testing.md](screenshot-testing.md)).

```kotlin
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.test.DeviceConfigurationOverride
import androidx.compose.ui.test.DarkMode
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@Composable
fun ThemeLabel() {
    Text(if (isSystemInDarkTheme()) "Dark theme" else "Light theme")
}

@RunWith(RobolectricTestRunner::class)
class ThemeLabelTest {
    @get:Rule val composeTestRule = createComposeRule()

    @Test
    fun lightByDefault() {
        composeTestRule.setContent { ThemeLabel() }
        composeTestRule.onNodeWithText("Light theme").assertIsDisplayed()
    }

    @Test
    fun darkWithOverride() {
        composeTestRule.setContent {
            DeviceConfigurationOverride(DeviceConfigurationOverride.DarkMode(true)) { ThemeLabel() }
        }
        composeTestRule.onNodeWithText("Dark theme").assertIsDisplayed()
    }

    @Test
    @Config(qualifiers = "night")
    fun darkWithQualifier() {
        composeTestRule.setContent { ThemeLabel() }
        composeTestRule.onNodeWithText("Dark theme").assertIsDisplayed()
    }
}
```

## Locale and String Resources

Both a locale qualifier and `DeviceConfigurationOverride.Locales` select localized resources. Given `res/values/strings.xml` and a French translation in the module:

```xml
<!-- src/main/res/values-fr/strings.xml -->
<resources>
    <string name="greeting">Bonjour</string>
</resources>
```

```kotlin
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.test.DeviceConfigurationOverride
import androidx.compose.ui.test.Locales
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.text.intl.LocaleList
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import skill.harness.R

@Composable
fun Welcome() {
    Text(stringResource(R.string.greeting))
}

@RunWith(RobolectricTestRunner::class)
class WelcomeLocaleTest {
    @get:Rule val composeTestRule = createComposeRule()

    @Test
    fun englishByDefault() {
        composeTestRule.setContent { Welcome() }
        composeTestRule.onNodeWithText("Hello").assertIsDisplayed()
    }

    @Test
    fun frenchWithOverride() {
        composeTestRule.setContent {
            DeviceConfigurationOverride(DeviceConfigurationOverride.Locales(LocaleList("fr-FR"))) { Welcome() }
        }
        composeTestRule.onNodeWithText("Bonjour").assertIsDisplayed()
    }

    @Test
    @Config(qualifiers = "fr-rFR")
    fun frenchWithQualifier() {
        composeTestRule.setContent { Welcome() }
        composeTestRule.onNodeWithText("Bonjour").assertIsDisplayed()
    }
}
```

Resource lookups need `unitTests.isIncludeAndroidResources = true` ([setup-configuration.md](../core/setup-configuration.md)). Asserting against hard-coded translations is fine for a few smoke tests; for the rest, read the expected string from resources (`composeTestRule.activity.getString(…)` with `createAndroidComposeRule<ComponentActivity>()`) so copy changes do not break tests.

## Right-to-Left Layouts

`DeviceConfigurationOverride.LayoutDirection(LayoutDirection.Rtl)` is the dependable way to test RTL. Assert positions, not just presence:

```kotlin
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.DeviceConfigurationOverride
import androidx.compose.ui.test.LayoutDirection
import androidx.compose.ui.test.getUnclippedBoundsInRoot
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.unit.LayoutDirection
import com.google.common.truth.Truth.assertThat
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

@Composable
fun Toolbar() {
    Row(Modifier.fillMaxWidth()) {
        Text("Back")
        Spacer(Modifier.weight(1f))
        Text("Share")
    }
}

@RunWith(RobolectricTestRunner::class)
class ToolbarRtlTest {
    @get:Rule val composeTestRule = createComposeRule()

    @Test
    fun backIsOnTheRightInRtl() {
        composeTestRule.setContent {
            DeviceConfigurationOverride(DeviceConfigurationOverride.LayoutDirection(LayoutDirection.Rtl)) { Toolbar() }
        }

        val back = composeTestRule.onNodeWithText("Back").getUnclippedBoundsInRoot()
        val share = composeTestRule.onNodeWithText("Share").getUnclippedBoundsInRoot()
        assertThat(back.left).isGreaterThan(share.left)
    }
}
```

With qualifiers, RTL needs two things, and the `ldrtl` qualifier alone was not enough with the pinned stack:

| Setup | `LocalLayoutDirection` |
| --- | --- |
| `@Config(qualifiers = "ldrtl")` | `Ltr` |
| `@Config(qualifiers = "ar-ldrtl")`, no `android:supportsRtl` in the manifest | `Ltr` |
| `@Config(qualifiers = "ar-ldrtl")` with `<application android:supportsRtl="true">` | `Rtl` |

Use an RTL locale (`ar`, `iw`, `fa`) and make sure the merged manifest sets `supportsRtl`.

## Screen Size and Orientation

Adaptive layouts read size either from `LocalConfiguration` / window size classes or from incoming constraints (`BoxWithConstraints`). The overrides differ in which they change:

| Tool | `LocalConfiguration.screenWidthDp` | Constraints |
| --- | --- | --- |
| `@Config(qualifiers = "w800dp-h400dp")` | Changes | Changes |
| `DeviceConfigurationOverride.WindowSize(DpSize(…))` | Changes | Changes |
| `DeviceConfigurationOverride.ForcedSize(DpSize(…))` | Unchanged (observed) | Changes; may scale density to fit |

```kotlin
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.test.DeviceConfigurationOverride
import androidx.compose.ui.test.WindowSize
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.unit.DpSize
import androidx.compose.ui.unit.dp
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@Composable
fun InboxLayout() {
    BoxWithConstraints {
        Text(if (maxWidth >= 600.dp) "Two panes" else "One pane")
    }
}

@RunWith(RobolectricTestRunner::class)
class InboxLayoutTest {
    @get:Rule val composeTestRule = createComposeRule()

    @Test
    fun phoneShowsOnePane() {
        composeTestRule.setContent { InboxLayout() }
        composeTestRule.onNodeWithText("One pane").assertIsDisplayed()
    }

    @Test
    fun tabletShowsTwoPanes() {
        composeTestRule.setContent {
            DeviceConfigurationOverride(DeviceConfigurationOverride.WindowSize(DpSize(840.dp, 900.dp))) { InboxLayout() }
        }
        composeTestRule.onNodeWithText("Two panes").assertIsDisplayed()
    }

    @Test
    @Config(qualifiers = "w800dp-h400dp-land")
    fun landscapeQualifier() {
        composeTestRule.setContent { InboxLayout() }
        composeTestRule.onNodeWithText("Two panes").assertIsDisplayed()
    }
}
```

Qualifiers have a fixed order (locale, layout direction, width, height, orientation, night mode, density, …). Out of order, Robolectric fails with `Failed to parse qualifier string '…'. Found unrecognized trailing qualifier segments …`.

To rotate mid-test, call `RuntimeEnvironment.setQualifiers("+land")`; the next frame sees the new `Configuration`. To also run the activity's recreation path, follow it with `scenario.recreate()` ([below](#activity-recreation)).

## Font Scale

`DeviceConfigurationOverride.FontScale(2f)` and `RuntimeEnvironment.setFontScale(2f)` both change `LocalDensity.current.fontScale`. Whether text actually grows depends on the graphics mode: in Robolectric's default `LEGACY` mode text metrics are fake, and with the pinned stack a `Text` was 35 dp tall at font scale 1 and at 2. Under `@GraphicsMode(NATIVE)` it measured 16 dp and 30 dp.

```kotlin
import androidx.compose.foundation.layout.Column
import androidx.compose.material3.Text
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.test.DeviceConfigurationOverride
import androidx.compose.ui.test.FontScale
import androidx.compose.ui.test.getUnclippedBoundsInRoot
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import com.google.common.truth.Truth.assertThat
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.GraphicsMode

@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class FontScaleTest {
    @get:Rule val composeTestRule = createComposeRule()

    @Test
    fun textGrowsWithFontScale() {
        composeTestRule.setContent {
            Column {
                Text("Total", Modifier.testTag("normal"))
                DeviceConfigurationOverride(DeviceConfigurationOverride.FontScale(2f)) {
                    Text("Total", Modifier.testTag("large"))
                }
            }
        }

        val normal = composeTestRule.onNodeWithTag("normal").getUnclippedBoundsInRoot()
        val large = composeTestRule.onNodeWithTag("large").getUnclippedBoundsInRoot()
        assertThat(large.bottom - large.top).isGreaterThan(normal.bottom - normal.top)
    }
}
```

The usual font-scale bugs (clipped labels, overlapping rows) are visual: catch them with screenshot tests at 1.0, 1.5, and 2.0 ([screenshot-testing.md](screenshot-testing.md)).

## State Restoration

`StateRestorationTester` saves and restores the composition's saveable state without recreating an activity, which is what `rememberSaveable` needs to be tested. It wraps the rule and replaces `setContent`:

```kotlin
import androidx.compose.material3.Button
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.StateRestorationTester
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

@Composable
fun Counters() {
    var saved by rememberSaveable { mutableStateOf(0) }
    var notSaved by remember { mutableStateOf(0) }
    Button(onClick = { saved++; notSaved++ }) { Text("Saved $saved, not saved $notSaved") }
}

@RunWith(RobolectricTestRunner::class)
class CountersRestorationTest {
    @get:Rule val composeTestRule = createComposeRule()

    @Test
    fun onlyRememberSaveableSurvives() {
        val restorationTester = StateRestorationTester(composeTestRule)
        restorationTester.setContent { Counters() }

        composeTestRule.onNodeWithText("Saved 0, not saved 0").performClick()
        restorationTester.emulateSavedInstanceStateRestore()

        composeTestRule.onNodeWithText("Saved 1, not saved 0").assertIsDisplayed()
    }
}
```

The tester encodes state the way the platform does (Compose 1.10 made platform encoding always on), so a value that cannot go in a `Bundle` fails here as it would in the app. With `runComposeUiTest`, use `androidx.compose.ui.test.StateRestorationTester(this)` and `emulateSaveAndRestore()`.

## Activity Recreation

To exercise a real activity's recreation (configuration change or process-death-like save and restore), launch it and call `ActivityScenario.recreate()`. The activity must call `setContent` itself; content set from the test is lost on recreation. Here the activity under test is `MainActivity` from the app module:

```kotlin snippet
class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            var count by rememberSaveable { mutableStateOf(0) }
            Column {
                Text("Home")
                Button(onClick = { count++ }) { Text("Count: $count") }
            }
        }
    }
}
```

```kotlin
import android.content.res.Configuration
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import com.example.app.MainActivity
import com.google.common.truth.Truth.assertThat
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment

@RunWith(RobolectricTestRunner::class)
class MainActivityRotationTest {
    @get:Rule val composeTestRule = createAndroidComposeRule<MainActivity>()

    @Test
    fun countSurvivesRotation() {
        composeTestRule.onNodeWithText("Count: 0").performClick()

        RuntimeEnvironment.setQualifiers("+land")
        composeTestRule.activityRule.scenario.recreate()

        assertThat(composeTestRule.activity.resources.configuration.orientation)
            .isEqualTo(Configuration.ORIENTATION_LANDSCAPE)
        composeTestRule.onNodeWithText("Count: 1").assertIsDisplayed()
    }
}
```

Recreating a `createAndroidComposeRule<ComponentActivity>()` activity after `composeTestRule.setContent { … }` leaves an empty activity, and the next finder fails with `No compose hierarchies found in the app`. Use `StateRestorationTester` for composables and `recreate()` for activities. Activities and the manifest are covered in [activities-intents.md](activities-intents.md).

## Anti-Patterns

| Anti-Pattern | Problem | Solution |
| --- | --- | --- |
| Asserting theme colors through semantics | Colors are not in the tree | Assert behavior; screenshot the colors |
| `@Config(qualifiers = "ldrtl")` to test RTL | Did not change layout direction | `DeviceConfigurationOverride.LayoutDirection`, or an RTL locale with `supportsRtl` |
| `ForcedSize` for a layout that reads `LocalConfiguration` | Configuration keeps the device size | `WindowSize` or a size qualifier |
| Asserting text size in `LEGACY` graphics | Text metrics are fake | `@GraphicsMode(NATIVE)` or screenshots |
| `recreate()` to test `rememberSaveable` in a composable | Test-set content is not recreated | `StateRestorationTester` |
| Hard-coded translations in every test | Breaks on copy changes | Read expected text from resources |
| A test per configuration copied and pasted | Duplication | Parameterize ([test-structure.md](../core/test-structure.md#parameterized-tests)) |

## Related References

- **Qualifier syntax and the default device**: [setup-configuration.md](../core/setup-configuration.md)
- **Pixels per configuration**: [screenshot-testing.md](screenshot-testing.md)
- **Text input and IME**: [forms-text-input.md](forms-text-input.md)
- **Activities and recreation**: [activities-intents.md](activities-intents.md)
- **Accessibility with large fonts**: [accessibility.md](accessibility.md)
