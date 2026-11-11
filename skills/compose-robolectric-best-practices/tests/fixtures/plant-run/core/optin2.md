# OptIn over several lines

```kotlin
@file:OptIn(
    ExperimentalTestApi::class,
)

import androidx.compose.material3.Text
import androidx.compose.ui.test.ExperimentalTestApi
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.v2.runComposeUiTest
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

@RunWith(RobolectricTestRunner::class)
class MultiLineOptInTest {
    @Test fun shows() = runComposeUiTest {
        setContent { Text("Opted in twice") }
        onNodeWithText("Opted in twice").assertIsDisplayed()
    }
}
```
