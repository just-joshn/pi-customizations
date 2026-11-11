# Run

A failing test:

```kotlin
import androidx.compose.material3.Text
import androidx.compose.ui.test.assertTextEquals
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

@RunWith(RobolectricTestRunner::class)
class FailingTest {
    @get:Rule val rule = createComposeRule()

    @Test fun fails() {
        rule.setContent { Text("Hello", Modifier.testTag("greeting")) }
        rule.onNodeWithTag("greeting").assertTextEquals("Goodbye")
    }
}
```

A failing test that is compile-only, so it never runs:

```kotlin compile-only
import org.junit.Assert.fail
import org.junit.Test

class CompileOnlyTest {
    @Test fun wouldFail() = fail("compile-only blocks must not run")
}
```

A passing test:

```kotlin
import org.junit.Assert.assertEquals
import org.junit.Test

class PassingTest {
    @Test fun adds() = assertEquals(4, 2 + 2)
}
```

```kotlin
import org.junit.Test

abstract class NeverRuns {
    @Test fun nothing() = Unit
}
```
