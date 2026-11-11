# Warn

Kotlin reports warnings only when a build has no errors, so the deprecated API gets its own fixture.

```kotlin compile-only
import androidx.compose.ui.test.junit4.createComposeRule

class DeprecatedRule {
    val rule = createComposeRule()
}
```
