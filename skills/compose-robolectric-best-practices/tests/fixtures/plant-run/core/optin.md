# OptIn

A valid file that starts with a file annotation.

```kotlin
@file:OptIn(ExperimentalTestApi::class)

import androidx.compose.material3.Text
import androidx.compose.ui.test.ExperimentalTestApi
import androidx.compose.ui.test.v2.runComposeUiTest
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.assertIsDisplayed
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

@RunWith(RobolectricTestRunner::class)
class OptInTest {
    @Test fun shows() = runComposeUiTest {
        setContent { Text("Opted in") }
        onNodeWithText("Opted in").assertIsDisplayed()
    }
}
```
