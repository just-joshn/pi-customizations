# Activities, Intents, Permissions, and Back Press

## Table of Contents

1. [Launching an Activity](#launching-an-activity)
2. [Verifying Outgoing Intents](#verifying-outgoing-intents)
3. [Following an Intent to the Next Activity](#following-an-intent-to-the-next-activity)
4. [Activity Results](#activity-results)
5. [Runtime Permissions](#runtime-permissions)
6. [Back Press](#back-press)
7. [Lifecycle States](#lifecycle-states)
8. [Anti-Patterns](#anti-patterns)
9. [Related References](#related-references)

## Launching an Activity

| Rule | Activity | Who calls `setContent` | Use for |
| --- | --- | --- | --- |
| `createComposeRule()` | An empty `ComponentActivity` from `ui-test-manifest` | The test | Composables and screens (most tests) |
| `createAndroidComposeRule<ComponentActivity>()` | Same, plus `composeTestRule.activity` | The test | Screens that need the activity (resources, `onBackPressedDispatcher`, `ActivityResultRegistry`) |
| `createAndroidComposeRule<MainActivity>()` | Your activity, launched before the test | The activity | Activity wiring: intents it sends, recreation, back handling |

Robolectric only starts activities declared in the merged manifest. An activity defined in `src/test` is not, and launching it fails with `Unable to resolve activity for Intent { act=android.intent.action.MAIN cat=[android.intent.category.LAUNCHER] cmp=… } -- see https://github.com/robolectric/robolectric/pull/4736 for details` ([common-errors.md](../debugging/common-errors.md#unable-to-resolve-activity-for-intent)).

The examples below exercise two small activities from the app module, declared in `src/main/AndroidManifest.xml`:

```xml
<manifest xmlns:android="http://schemas.android.com/apk/res/android">
    <uses-permission android:name="android.permission.CAMERA" />
    <application android:supportsRtl="true">
        <activity android:name="com.example.app.MainActivity" android:exported="true" />
        <activity android:name="com.example.app.DetailActivity" android:exported="false" />
    </application>
</manifest>
```

`MainActivity` shows "Home", a saveable counter, an "Open details" button that starts `DetailActivity` with `putExtra(DetailActivity.EXTRA_ID, 42)`, and a "Share" button that starts an `ACTION_SEND` text intent. `DetailActivity` shows `Text("Item $id")` for the `id` extra.

```kotlin
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import com.example.app.MainActivity
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

@RunWith(RobolectricTestRunner::class)
class MainActivityTest {
    @get:Rule val composeTestRule = createAndroidComposeRule<MainActivity>()

    @Test
    fun showsHomeAndCounts() {
        composeTestRule.onNodeWithText("Home").assertIsDisplayed()

        composeTestRule.onNodeWithText("Count: 0").performClick()

        composeTestRule.onNodeWithText("Count: 1").assertIsDisplayed()
    }
}
```

Do not call `composeTestRule.setContent` with an activity that sets its own content. To launch with a specific intent (extras, deep link data), build an `ActivityScenarioRule(intent)` and wrap it with the v2 `AndroidComposeTestRule(activityRule) { … }` overload, or launch with `ActivityScenario.launch` as in [Following an Intent](#following-an-intent-to-the-next-activity).

## Verifying Outgoing Intents

`espresso-intents` records every intent the app starts between `Intents.init()` and `Intents.release()`. Call them in `@Before` / `@After` so a failing test cannot leave recording on for the next one.

```kotlin
import android.content.Intent
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.test.espresso.intent.Intents
import androidx.test.espresso.intent.Intents.intended
import androidx.test.espresso.intent.matcher.IntentMatchers.hasAction
import androidx.test.espresso.intent.matcher.IntentMatchers.hasComponent
import androidx.test.espresso.intent.matcher.IntentMatchers.hasExtra
import androidx.test.espresso.intent.matcher.IntentMatchers.hasType
import com.example.app.DetailActivity
import com.example.app.MainActivity
import org.hamcrest.Matchers.allOf
import org.junit.After
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

@RunWith(RobolectricTestRunner::class)
class MainActivityIntentsTest {
    @get:Rule val composeTestRule = createAndroidComposeRule<MainActivity>()

    @Before fun startRecording() = Intents.init()

    @After fun stopRecording() = Intents.release()

    @Test
    fun openDetailsStartsDetailActivityWithId() {
        composeTestRule.onNodeWithText("Open details").performClick()

        intended(allOf(hasComponent(DetailActivity::class.java.name), hasExtra(DetailActivity.EXTRA_ID, 42)))
    }

    @Test
    fun shareSendsPlainText() {
        composeTestRule.onNodeWithText("Share").performClick()

        intended(allOf(hasAction(Intent.ACTION_SEND), hasType("text/plain"), hasExtra(Intent.EXTRA_TEXT, "Hello")))
    }
}
```

Without `espresso-intents`, Robolectric records started activities itself: `shadowOf(activity).nextStartedActivity` returns the next intent (or `null`). That works for implicit intents with no matching app, too: a button calling `startActivity(Intent(ACTION_VIEW, uri))` did not throw `ActivityNotFoundException` with the pinned stack, so a missing `resolveActivity` check is not caught here.

## Following an Intent to the Next Activity

Robolectric does not start the next activity for you. Take the recorded intent and launch it; the Compose rule finds composables in whichever activity is resumed.

```kotlin
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.test.core.app.ActivityScenario
import com.example.app.DetailActivity
import com.example.app.MainActivity
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf

@RunWith(RobolectricTestRunner::class)
class OpenDetailsFlowTest {
    @get:Rule val composeTestRule = createAndroidComposeRule<MainActivity>()

    @Test
    fun detailShowsTheSelectedItem() {
        composeTestRule.onNodeWithText("Open details").performClick()
        val next = shadowOf(composeTestRule.activity).nextStartedActivity

        ActivityScenario.launch<DetailActivity>(next).use {
            composeTestRule.onNodeWithText("Item 42").assertIsDisplayed()
        }
    }
}
```

For single-activity apps, navigation between screens is a [navigation.md](navigation.md) topic, not an intent one.

## Activity Results

A composable that uses `rememberLauncherForActivityResult` gets its `ActivityResultRegistry` from `LocalActivityResultRegistryOwner`. Two ways to control the result:

| Approach | Use when |
| --- | --- |
| `intending(matcher).respondWith(ActivityResult(…))` with `espresso-intents` | The contract launches an intent (`StartActivityForResult`, `GetContent`, `PickContact`) |
| A fake `ActivityResultRegistry` provided through `LocalActivityResultRegistryOwner` | Any contract, including permissions; no activity or intents needed |

```kotlin
import android.app.Activity
import android.app.Instrumentation
import android.content.Intent
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Column
import androidx.compose.material3.Button
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.test.espresso.intent.Intents
import androidx.test.espresso.intent.Intents.intending
import androidx.test.espresso.intent.matcher.IntentMatchers.hasAction
import org.junit.After
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

@Composable
fun ContactPicker() {
    var name by remember { mutableStateOf("Nobody") }
    val launcher = rememberLauncherForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        name = result.data?.getStringExtra("name") ?: "Cancelled"
    }
    Column {
        Button(onClick = { launcher.launch(Intent(Intent.ACTION_PICK)) }) { Text("Pick contact") }
        Text("Selected: $name")
    }
}

@RunWith(RobolectricTestRunner::class)
class ContactPickerTest {
    @get:Rule val composeTestRule = createComposeRule()

    @Before fun startRecording() = Intents.init()

    @After fun stopRecording() = Intents.release()

    @Test
    fun showsThePickedContact() {
        intending(hasAction(Intent.ACTION_PICK))
            .respondWith(Instrumentation.ActivityResult(Activity.RESULT_OK, Intent().putExtra("name", "Ada")))
        composeTestRule.setContent { ContactPicker() }

        composeTestRule.onNodeWithText("Pick contact").performClick()

        composeTestRule.onNodeWithText("Selected: Ada").assertIsDisplayed()
    }
}
```

The fake registry answers every launch with a fixed result through `dispatchResult`; see the denied-permission test below.

## Runtime Permissions

`ActivityResultContracts.RequestPermission` first checks whether the permission is already granted and, if so, returns `true` without showing anything. Robolectric starts with dangerous permissions denied, and `shadowOf(application).grantPermissions(…)` grants them. When the permission is not granted, the launch is only recorded (`shadowOf(activity).lastRequestedPermission`), no result arrives, and the UI stays as it was; use a fake registry to deliver the denial.

```kotlin
import android.Manifest
import android.app.Application
import androidx.activity.compose.LocalActivityResultRegistryOwner
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.ActivityResultRegistry
import androidx.activity.result.ActivityResultRegistryOwner
import androidx.activity.result.contract.ActivityResultContract
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Column
import androidx.compose.material3.Button
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.core.app.ActivityOptionsCompat
import androidx.test.core.app.ApplicationProvider
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf

@Composable
fun CameraGate() {
    var status by remember { mutableStateOf("Camera not requested") }
    val launcher = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        status = if (granted) "Camera ready" else "Camera permission denied"
    }
    Column {
        Button(onClick = { launcher.launch(Manifest.permission.CAMERA) }) { Text("Use camera") }
        Text(status)
    }
}

class FixedResultRegistry(private val result: Any?) : ActivityResultRegistry() {
    override fun <I, O> onLaunch(requestCode: Int, contract: ActivityResultContract<I, O>, input: I, options: ActivityOptionsCompat?) {
        dispatchResult(requestCode, result)
    }
}

@RunWith(RobolectricTestRunner::class)
class CameraGateTest {
    @get:Rule val composeTestRule = createComposeRule()

    @Test
    fun grantedPermission() {
        shadowOf(ApplicationProvider.getApplicationContext<Application>()).grantPermissions(Manifest.permission.CAMERA)
        composeTestRule.setContent { CameraGate() }

        composeTestRule.onNodeWithText("Use camera").performClick()

        composeTestRule.onNodeWithText("Camera ready").assertIsDisplayed()
    }

    @Test
    fun deniedPermission() {
        val owner = object : ActivityResultRegistryOwner {
            override val activityResultRegistry = FixedResultRegistry(result = false)
        }
        composeTestRule.setContent {
            CompositionLocalProvider(LocalActivityResultRegistryOwner provides owner) { CameraGate() }
        }

        composeTestRule.onNodeWithText("Use camera").performClick()

        composeTestRule.onNodeWithText("Camera permission denied").assertIsDisplayed()
    }
}
```

Granting is per test: Robolectric resets the application between tests. The permission must be declared with `<uses-permission>` in the app manifest for the real app; the test does not check that.

## Back Press

| Call | Reaches |
| --- | --- |
| `Espresso.pressBack()` | The focused window: `BackHandler` in the activity, or an open dialog or sheet |
| `activity.onBackPressedDispatcher.onBackPressed()` (on the UI thread) | The activity's `BackHandler`s; not dialogs ([dialogs-popups.md](dialogs-popups.md#dismissing-with-back)) |
| `Espresso.pressBackUnconditionally()` | Like `pressBack`, for presses that are expected to leave the app |

To test "back exits the app", press back and assert `activity.isFinishing`. Espresso documents `pressBackUnconditionally()` for presses that leave the app; under Robolectric plain `pressBack()` on the last activity did not throw with the pinned stack and also finished it, so a test that passes here may still fail on a device if it uses `pressBack()`.

```kotlin
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.test.espresso.Espresso
import com.google.common.truth.Truth.assertThat
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

@Composable
fun SearchScreen() {
    var searching by remember { mutableStateOf(true) }
    BackHandler(enabled = searching) { searching = false }
    Text(if (searching) "Search open" else "Search closed")
}

@RunWith(RobolectricTestRunner::class)
class SearchBackTest {
    @get:Rule val composeTestRule = createAndroidComposeRule<ComponentActivity>()

    @Test
    fun firstBackClosesSearch() {
        composeTestRule.setContent { SearchScreen() }

        Espresso.pressBack()

        composeTestRule.onNodeWithText("Search closed").assertIsDisplayed()
        assertThat(composeTestRule.activity.isFinishing).isFalse()
    }

    @Test
    fun secondBackLeavesTheActivity() {
        composeTestRule.setContent { SearchScreen() }

        Espresso.pressBack()
        composeTestRule.onNodeWithText("Search closed").assertIsDisplayed() // lets BackHandler see enabled = false
        Espresso.pressBackUnconditionally()

        assertThat(composeTestRule.activity.isFinishing).isTrue()
    }
}
```

## Lifecycle States

`ActivityScenario.moveToState(…)` drives the activity through the lifecycle, for testing `LifecycleEventEffect`, `collectAsStateWithLifecycle`, and anything that pauses work in the background. Assert through callbacks or state, then return to `RESUMED` before using Compose finders: while the activity was `CREATED` (stopped), finders failed with `No compose hierarchies found in the app`.

```kotlin
import androidx.activity.ComponentActivity
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LifecycleEventEffect
import com.google.common.truth.Truth.assertThat
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

@Composable
fun PlayerScreen(onPause: () -> Unit) {
    LifecycleEventEffect(Lifecycle.Event.ON_STOP) { onPause() }
    Text("Playing")
}

@RunWith(RobolectricTestRunner::class)
class PlayerLifecycleTest {
    @get:Rule val composeTestRule = createAndroidComposeRule<ComponentActivity>()

    @Test
    fun pausesWhenTheAppGoesToTheBackground() {
        var pauses = 0
        composeTestRule.setContent { PlayerScreen(onPause = { pauses++ }) }
        composeTestRule.onNodeWithText("Playing").assertIsDisplayed()

        val scenario = composeTestRule.activityRule.scenario
        scenario.moveToState(Lifecycle.State.CREATED)
        assertThat(pauses).isEqualTo(1)

        scenario.moveToState(Lifecycle.State.RESUMED)
        composeTestRule.onNodeWithText("Playing").assertIsDisplayed()
    }
}
```

## Anti-Patterns

| Anti-Pattern | Problem | Solution |
| --- | --- | --- |
| A test-only `Activity` in `src/test` | Not in the manifest; "Unable to resolve activity" | `ComponentActivity` + `setContent`, or declare it in a `src/debug` manifest |
| `composeTestRule.setContent` on an activity that sets its own content | Two contents fight; the activity's is replaced | Pick one owner of `setContent` |
| `Intents.init()` without `release()` in `@After` | Recording leaks into later tests | `@Before` / `@After` pair |
| Expecting the next activity to open after `startActivity` | Robolectric only records it | Launch `nextStartedActivity` yourself |
| Testing a denied permission by not granting it | No result is delivered; the UI never changes | A fake `ActivityResultRegistry` |
| `Espresso.pressBack()` to exit the last activity | Passes under Robolectric, not portable to devices | `pressBackUnconditionally()` |
| Compose finders while the activity is stopped | "No compose hierarchies found" | Move back to `RESUMED` first |

## Related References

- **Single-activity navigation**: [navigation.md](navigation.md)
- **Dialogs and back**: [dialogs-popups.md](dialogs-popups.md)
- **Recreation and rotation**: [configuration-changes.md](configuration-changes.md#activity-recreation)
- **View-based activities hosting Compose**: [interop-views.md](interop-views.md)
- **Manifest and setup errors**: [common-errors.md](../debugging/common-errors.md)
