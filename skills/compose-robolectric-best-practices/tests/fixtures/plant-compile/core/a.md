# A

[gone](gone.md)

[upstream](https://playwright.dev/docs/intro)

Leftover upstream code:

```typescript
await page.click('text=Hi');
```

```kotlin snippet
val a = 1
val b = 2
val c = 3
val d = 4
val e = 5
val f = 6
val g = 7
val h = 8
val i = 9
val j = 10
val k = 11
val l = 12
val m = 13
```

```kts
dependencies {
    testImplementation(platform("androidx.compose:compose-bom:2024.01.00"))
    testImplementation("com.example:unknown:1.0")
    testImplementation("org.robolectric:robolectric:4.17")
}
```

```kotlin
import androidx.compose.material3.Text
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

@RunWith(RobolectricTestRunner::class)
class MadeUpAssertionTest {
    @get:Rule val rule = createComposeRule()

    @Test fun shows() {
        rule.setContent { Text("hi") }
        rule.onNodeWithText("hi").assertIsShownNow()
    }
}
```


```toml
[versions]
agp = "9.0.0"

[plugins]
android-application = { id = "com.android.application", version.ref = "agp" }
```
