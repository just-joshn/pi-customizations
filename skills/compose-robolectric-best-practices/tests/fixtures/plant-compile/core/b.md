# B

A block with its own package line, which the gate replaces.

```kotlin
package com.example.app

import androidx.compose.ui.test.junit4.v2.createComposeRule

class TypoTest {
    val rule = createComposeRule()

    fun find() = rule.onNodeWithTxt("x")
}
```
