# Annotations & Filtering

## Table of Contents

1. [Quick Reference](#quick-reference)
2. [@Ignore](#ignore)
3. [Assumptions](#assumptions)
4. [Per-Test @Config](#per-test-config)
5. [SDK Ranges and Test Names](#sdk-ranges-and-test-names)
6. [Looper and Graphics Mode per Test](#looper-and-graphics-mode-per-test)
7. [Running a Subset from the Command Line](#running-a-subset-from-the-command-line)
8. [Filtering in Gradle](#filtering-in-gradle)
9. [JUnit Categories](#junit-categories)
10. [Anti-Patterns](#anti-patterns)
11. [Related References](#related-references)

## Quick Reference

| Need | Use |
| --- | --- |
| Turn a test off, with a reason | `@Ignore("…")` |
| Skip when a runtime condition is false | `Assume.assumeTrue(message, condition)` |
| Different SDK, locale, size, night mode for one test | `@Config(sdk = …)`, `@Config(qualifiers = …)` on the method |
| Run on several SDKs | `@Config(sdk = [34, 36])` or `minSdk`/`maxSdk` |
| Real pixels for one test | `@GraphicsMode(GraphicsMode.Mode.NATIVE)` on the method or class |
| Run one class or method | `./gradlew :app:testDebugUnitTest --tests '…'` |
| Exclude a group permanently in a build | `filter { excludeTestsMatching(…) }` or JUnit categories |

## @Ignore

`@Ignore` on a method or class skips it. Gradle reports it as skipped. Always give a reason, ideally a tracker link, so it gets removed:

```kotlin snippet
@Ignore("Flaky on CI: https://issues.example.com/APP-123")
@Test
fun swipeToDismiss_removesRow() { /* … */ }
```

An ignored test is dead code that still compiles. Fix or delete it within a release or two.

## Assumptions

`Assume.assumeTrue` / `assumeFalse` / `assumeNotNull` stop the test at runtime and report it as **skipped**, not passed or failed. Use them for conditions only known at runtime, such as the SDK when the class runs on several:

```kotlin
import android.os.Build
import androidx.compose.material3.Text
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import org.junit.Assume.assumeTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34, 36])
class PhotoPickerBannerTest {
    @get:Rule val composeTestRule = createComposeRule()

    @Test
    fun banner_rendersOnEverySdk() {
        composeTestRule.setContent { Text("Choose photos") }

        composeTestRule.onNodeWithText("Choose photos").assertIsDisplayed()
    }

    @Test
    fun newApiPath_onlyOnBaklavaAndLater() {
        assumeTrue("needs API 36", Build.VERSION.SDK_INT >= 36)   // skipped on 34

        composeTestRule.setContent { Text("API ${Build.VERSION.SDK_INT}") }

        composeTestRule.onNodeWithText("API 36").assertIsDisplayed()
    }
}
```

When the condition is static (always skip on SDK 34), a method-level `@Config(sdk = [36])` is clearer than an assumption: the test isn't even created for 34. An assumption that is always false silently skips a test, like an `@Ignore` without a reason, so watch skipped counts in CI.

## Per-Test @Config

`@Config` on a method overrides the class's `@Config`, which overrides `robolectric.properties` ([setup-configuration.md](setup-configuration.md#config-and-robolectricproperties)). Per-method configuration keeps one class per screen while varying the environment:

```kotlin
import android.content.res.Configuration
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.platform.LocalConfiguration
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
    val night = LocalConfiguration.current.uiMode and Configuration.UI_MODE_NIGHT_MASK ==
        Configuration.UI_MODE_NIGHT_YES
    Text(if (night) "Dark theme" else "Light theme")
}

@RunWith(RobolectricTestRunner::class)
class ThemeLabelTest {
    @get:Rule val composeTestRule = createComposeRule()

    @Test
    fun default_isLight() {
        composeTestRule.setContent { ThemeLabel() }
        composeTestRule.onNodeWithText("Light theme").assertIsDisplayed()
    }

    @Test
    @Config(qualifiers = "+night")
    fun nightQualifier_isDark() {
        composeTestRule.setContent { ThemeLabel() }
        composeTestRule.onNodeWithText("Dark theme").assertIsDisplayed()
    }
}
```

A leading `+` adds to the qualifiers already in effect (from the class or properties file) instead of replacing them. For dark mode, locale, RTL, and font scale, `DeviceConfigurationOverride` inside `setContent` is often lighter than a Robolectric qualifier; see [configuration-changes.md](../testing-patterns/configuration-changes.md).

## SDK Ranges and Test Names

| `@Config` | Runs the test on |
| --- | --- |
| *(none)* | `targetSdk` |
| `sdk = [36]` | API 36 |
| `sdk = [34, 36]` | API 34 and API 36, once each |
| `minSdk = 34` | Every supported API from 34 up |
| `minSdk = 30, maxSdk = 34` | Every supported API from 30 to 34 |

`sdk` cannot be combined with `minSdk`/`maxSdk` in one `@Config`; `minSdk` and `maxSdk` can be combined. Each SDK downloads its own `android-all-instrumented` jar and runs in its own sandbox, so ranges multiply run time ([performance.md](../infrastructure-ci-cd/performance.md)). Choosing SDKs is covered in [setup-configuration.md](setup-configuration.md#choosing-sdk-levels).

When a test runs on several SDKs, the report names the run on the **highest** SDK plainly and adds a suffix for the others. With the pinned stack, `@Config(sdk = [34, 36])` on `banner_rendersOnEverySdk` produced the test cases `banner_rendersOnEverySdk` (36) and `banner_rendersOnEverySdk[34]`. Use a trailing wildcard to select all of them from the command line.

Robolectric's `robolectric.enabledSdks` system property limits which SDKs run in a process (for example, only the newest on pre-merge, all of them nightly):

```kts
android {
    testOptions {
        unitTests.all {
            it.systemProperty("robolectric.enabledSdks", "36")
        }
    }
}
```

## Looper and Graphics Mode per Test

Both annotations work on a package, class, or method. Defaults in 4.17 are `LooperMode.PAUSED` and `GraphicsMode.LEGACY`; what each mode means is in [setup-configuration.md](setup-configuration.md#looper-and-graphics-modes).

```kotlin
import androidx.compose.material3.Text
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import com.google.common.truth.Truth.assertThat
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.GraphicsMode

@RunWith(RobolectricTestRunner::class)
class TitleLayoutTest {
    @get:Rule val composeTestRule = createComposeRule()

    @Test
    @GraphicsMode(GraphicsMode.Mode.NATIVE)   // real text measurement for this test only
    fun title_fitsOnOneLine() {
        composeTestRule.setContent { Text("Hello world") }

        val size = composeTestRule.onNodeWithText("Hello world").fetchSemanticsNode().size

        assertThat(size.width).isGreaterThan(size.height)
    }
}
```

Under the default `LEGACY` graphics mode, text measurement is not realistic: with the pinned stack the same `Text("Hello world")` measured 11×35 px in `LEGACY` and 69×16 px in `NATIVE`. Size and layout assertions on text need `NATIVE`; semantics assertions don't. Leave `@LooperMode` alone: `PAUSED` is the default, and `LEGACY` is deprecated (and a compile error in a warnings-as-errors build).

## Running a Subset from the Command Line

Filtering uses Gradle's `--tests` option on the **variant** task. AGP's aggregate `test` task does not accept it (`Unknown command-line option '--tests'` with the pinned stack).

```bash
# One class
./gradlew :app:testDebugUnitTest --tests 'com.example.login.LoginScreenTest'

# One method (add * to include the [34]-style runs on other SDKs)
./gradlew :app:testDebugUnitTest --tests 'com.example.login.LoginScreenTest.shortPassword_showsError*'

# Every class matching a pattern; repeat --tests to OR patterns
./gradlew :app:testDebugUnitTest --tests '*ScreenTest' --tests '*RobotTest'

# A package
./gradlew :app:testDebugUnitTest --tests 'com.example.checkout.*'

# Re-run even if Gradle thinks the task is up to date
./gradlew :app:testDebugUnitTest --tests '*LoginScreenTest' --rerun
```

`--tests` patterns match the fully qualified class name plus method name, with `*` as a wildcard. A pattern that matches nothing fails the task unless `filter.isFailOnNoMatchingTests = false`. In Android Studio, the gutter run icon next to a class or method does the same.

## Filtering in Gradle

For permanent filters, such as keeping screenshot tests out of the default run, configure the test tasks:

```kts
android {
    testOptions {
        unitTests.all {
            if (!providers.gradleProperty("includeScreenshots").isPresent) {
                it.filter.excludeTestsMatching("*ScreenshotTest")
            }
        }
    }
}
```

Then `./gradlew :app:testDebugUnitTest -PincludeScreenshots` runs everything. Naming conventions (`*ScreenshotTest`, `*FlowTest`) make these filters reliable. Roborazzi's own record and verify tasks are covered in [screenshot-testing.md](../testing-patterns/screenshot-testing.md).

## JUnit Categories

JUnit 4 categories tag classes or methods with a marker interface. Gradle's JUnit 4 support can include or exclude them:

```kotlin
import com.google.common.truth.Truth.assertThat
import org.junit.Test
import org.junit.experimental.categories.Category
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

interface SlowTests

@RunWith(RobolectricTestRunner::class)
class CatalogTest {
    @Test
    fun fastCheck() {
        assertThat(listOf("a", "b")).hasSize(2)
    }

    @Test
    @Category(SlowTests::class)
    fun fullCatalogScan() {
        assertThat((1..1_000).sum()).isEqualTo(500_500)
    }
}
```

```kts
android {
    testOptions {
        unitTests.all {
            it.useJUnit { excludeCategories("com.example.testing.SlowTests") }
        }
    }
}
```

The category name must be the fully qualified name of a class on the test classpath: with the pinned stack, a name that did not resolve failed the whole task with `Can't load category class`. Name patterns are simpler and need no marker types, so prefer them unless the team already uses categories.

## Anti-Patterns

| Anti-pattern | Problem | Do instead |
| --- | --- | --- |
| `@Ignore` with no reason | Nobody knows when to re-enable | `@Ignore("why + link")` |
| `if (Build.VERSION.SDK_INT < 36) return` | Reports a pass for a test that didn't run | `assumeTrue` or `@Config(sdk = …)` |
| `minSdk` ranges on every class | Every test runs on every SDK; slow | Default SDK; a few targeted multi-SDK tests |
| `./gradlew test --tests …` | Fails: aggregate task has no `--tests` | Use `testDebugUnitTest` |
| `--tests '…Test.method'` on a multi-SDK class | Misses the `[34]` runs | Add a trailing `*` |
| `@LooperMode(LEGACY)` to "fix" timing | Deprecated, unsupported after SDK 36 | Fix the synchronization ([synchronization.md](synchronization.md)) |
| `@GraphicsMode(NATIVE)` module-wide for one layout test | Slows every test | Annotate only the tests that need pixels or real text size |

## Related References

- [setup-configuration.md](setup-configuration.md): `@Config`, `robolectric.properties`, modes
- [configuration-changes.md](../testing-patterns/configuration-changes.md): qualifiers vs `DeviceConfigurationOverride`
- [ci.md](../infrastructure-ci-cd/ci.md), [performance.md](../infrastructure-ci-cd/performance.md): sharding and SDK choices in CI
- [flaky-tests.md](../debugging/flaky-tests.md): what to do instead of `@Ignore`
