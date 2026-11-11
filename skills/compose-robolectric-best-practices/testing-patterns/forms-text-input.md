# Text Fields and Forms

## Table of Contents

1. [Quick Reference](#quick-reference)
2. [How a Text Field Looks to a Test](#how-a-text-field-looks-to-a-test)
3. [Typing, Replacing, Clearing](#typing-replacing-clearing)
4. [Validation Errors](#validation-errors)
5. [IME Actions and Focus](#ime-actions-and-focus)
6. [Password Fields](#password-fields)
7. [TextFieldState-Based Fields](#textfieldstate-based-fields)
8. [The Software Keyboard Under Robolectric](#the-software-keyboard-under-robolectric)
9. [Anti-Patterns](#anti-patterns)

## Quick Reference

| Goal | API |
| --- | --- |
| Find a field by its label | `onNodeWithText("Email")` (the label merges into the field node) |
| Find any editable field | `onNode(isEditable())` / `onAllNodes(isEditable())` |
| Type at the cursor | `performTextInput("abc")` |
| Move the cursor | `performTextInputSelection(TextRange(i))` |
| Replace all text | `performTextReplacement("abc")` |
| Clear | `performTextClearance()` |
| Check label + value | `assertTextEquals("Email", "ada@example.com")` |
| Check value contains | `assertTextContains("example", substring = true)` |
| Press the IME action | `performImeAction()` |
| Focus | `requestFocus()`, `assertIsFocused()`, `assertIsNotFocused()` |
| Error state | `SemanticsMatcher.keyIsDefined(SemanticsProperties.Error)` |

## How a Text Field Looks to a Test

A Material `TextField` or `OutlinedTextField` is one merged node with two text properties:

| Semantics property | Holds | Read by |
| --- | --- | --- |
| `Text` | The label, placeholder, and supporting text (a list) | `hasText`, `onNodeWithText`, `assertTextEquals` |
| `EditableText` | What the user typed | `hasText`, `onNodeWithText`, `assertTextEquals` (both include editable text by default) |

So `onNodeWithText("Email")` finds the field by its label, and `onNodeWithText("ada@example.com")` finds it by its value. `assertTextEquals` compares the **whole** list, in order: label (and other decoration text) first, then the editable text. Pass `includeEditableText = false` to compare only the decoration.

```kotlin
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.test.assertTextEquals
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performTextInput
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

@RunWith(RobolectricTestRunner::class)
class EmailFieldTest {
    @get:Rule val composeTestRule = createComposeRule()

    @Test
    fun labelAndValueAreBothInTheNode() {
        composeTestRule.setContent {
            var email by remember { mutableStateOf("") }
            OutlinedTextField(value = email, onValueChange = { email = it }, label = { Text("Email") })
        }

        composeTestRule.onNodeWithText("Email").performTextInput("ada@example.com")

        composeTestRule.onNodeWithText("Email").assertTextEquals("Email", "ada@example.com")
        composeTestRule.onNodeWithText("Email").assertTextEquals("Email", includeEditableText = false)
    }
}
```

A `BasicTextField` has no label. Give it a `contentDescription` or a `testTag` so a test (and TalkBack) can identify it; see [accessibility.md](accessibility.md).

## Typing, Replacing, Clearing

`performTextInput` inserts at the cursor, like an IME commit. `performTextReplacement` replaces everything. Both focus the field first. They require a controlled field to actually update its state in `onValueChange`; a field that ignores the change keeps its old text, and the assertion shows it.

Where the cursor starts matters. A `TextField(value: String, ...)` prefilled with "Paris" starts with the cursor at position 0, so with the pinned stack `performTextInput(", France")` produced `", FranceParis"`, not `"Paris, France"`. Move the cursor with `performTextInputSelection` first, or use `performTextReplacement` when the test only needs the final value.

```kotlin
import androidx.compose.material3.Text
import androidx.compose.material3.TextField
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.test.assertTextEquals
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performTextClearance
import androidx.compose.ui.test.performTextInput
import androidx.compose.ui.test.performTextInputSelection
import androidx.compose.ui.test.performTextReplacement
import androidx.compose.ui.text.TextRange
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

@RunWith(RobolectricTestRunner::class)
class CityFieldTest {
    @get:Rule val composeTestRule = createComposeRule()

    @Before
    fun setUp() {
        composeTestRule.setContent {
            var city by remember { mutableStateOf("Paris") }
            TextField(value = city, onValueChange = { city = it }, label = { Text("City") })
        }
    }

    @Test
    fun inputGoesWhereTheCursorIs() {
        composeTestRule.onNodeWithText("City").performTextInput(", France")

        composeTestRule.onNodeWithText("City").assertTextEquals("City", ", FranceParis")
    }

    @Test
    fun moveTheCursorToAppend() {
        composeTestRule.onNodeWithText("City").performTextInputSelection(TextRange("Paris".length))
        composeTestRule.onNodeWithText("City").performTextInput(", France")

        composeTestRule.onNodeWithText("City").assertTextEquals("City", "Paris, France")
    }

    @Test
    fun replacementOverwrites() {
        composeTestRule.onNodeWithText("City").performTextReplacement("Lyon")

        composeTestRule.onNodeWithText("City").assertTextEquals("City", "Lyon")
    }

    @Test
    fun clearanceEmptiesTheField() {
        composeTestRule.onNodeWithText("City").performTextClearance()

        composeTestRule.onNodeWithText("City").assertTextEquals("City", "")
    }
}
```

Input filtering (digits only, max length) is behavior worth testing through `performTextInput`: type a disallowed string and assert the value that remains.

## Validation Errors

Material 3 `TextField` with `isError = true` adds the `Error` semantics property, and `supportingText` joins the field's `Text` list. Assert both: the message the user reads and the error state TalkBack announces.

```kotlin
import androidx.compose.foundation.layout.Column
import androidx.compose.material3.Button
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.assert
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextInput
import androidx.compose.ui.test.performTextReplacement
import com.google.common.truth.Truth.assertThat
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

@Composable
fun SignUpForm(onSubmit: (String) -> Unit) {
    var email by remember { mutableStateOf("") }
    var touched by remember { mutableStateOf(false) }
    val valid = "@" in email && "." in email.substringAfter("@")
    val showError = touched && !valid
    Column {
        OutlinedTextField(
            value = email,
            onValueChange = { email = it; touched = true },
            label = { Text("Email") },
            isError = showError,
            supportingText = { if (showError) Text("Enter a valid email") },
        )
        Button(onClick = { onSubmit(email) }, enabled = valid) { Text("Sign up") }
    }
}

@RunWith(RobolectricTestRunner::class)
class SignUpFormTest {
    @get:Rule val composeTestRule = createComposeRule()

    private val hasError = SemanticsMatcher.keyIsDefined(SemanticsProperties.Error)

    @Test
    fun invalidEmailShowsAnErrorAndDisablesSubmit() {
        composeTestRule.setContent { SignUpForm(onSubmit = {}) }

        composeTestRule.onNodeWithText("Email").performTextInput("ada@")

        composeTestRule.onNodeWithText("Email").assert(hasError)
        composeTestRule.onNodeWithText("Enter a valid email").assertIsDisplayed()
        composeTestRule.onNodeWithText("Sign up").assertIsNotEnabled()
    }

    @Test
    fun fixingTheEmailClearsTheErrorAndSubmits() {
        val submitted = mutableListOf<String>()
        composeTestRule.setContent { SignUpForm(onSubmit = { submitted += it }) }
        composeTestRule.onNodeWithText("Email").performTextInput("ada@")

        composeTestRule.onNodeWithText("Email").performTextReplacement("ada@example.com")

        composeTestRule.onNodeWithText("Email").assert(!hasError)
        composeTestRule.onNodeWithText("Enter a valid email").assertDoesNotExist()
        composeTestRule.onNodeWithText("Sign up").assertIsEnabled().performClick()
        assertThat(submitted).containsExactly("ada@example.com")
    }
}
```

The error message is found through the field node, because supporting text merges into it. To check the exact error text TalkBack reads, compare the property: `SemanticsMatcher.expectValue(SemanticsProperties.Error, "...")`. Material sets its own default description, so prefer asserting the visible supporting text you control.

## IME Actions and Focus

`performImeAction()` triggers the action set in `keyboardOptions` (`ImeAction.Next`, `Done`, `Search`, ...). It fails if the field has no IME action (`ImeAction.Default`), which itself catches a missing `keyboardOptions`. With `ImeAction.Next` and no custom handler, focus moves to the next focusable field.

```kotlin
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Text
import androidx.compose.material3.TextField
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.test.assertIsFocused
import androidx.compose.ui.test.assertIsNotFocused
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performImeAction
import androidx.compose.ui.test.performTextInput
import androidx.compose.ui.test.requestFocus
import androidx.compose.ui.text.input.ImeAction
import com.google.common.truth.Truth.assertThat
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

@RunWith(RobolectricTestRunner::class)
class SearchFormTest {
    @get:Rule val composeTestRule = createComposeRule()

    @Test
    fun nextMovesFocusAndDoneSubmits() {
        val searches = mutableListOf<Pair<String, String>>()
        composeTestRule.setContent {
            var what by remember { mutableStateOf("") }
            var where by remember { mutableStateOf("") }
            Column {
                TextField(
                    value = what,
                    onValueChange = { what = it },
                    label = { Text("What") },
                    keyboardOptions = KeyboardOptions(imeAction = ImeAction.Next),
                )
                TextField(
                    value = where,
                    onValueChange = { where = it },
                    label = { Text("Where") },
                    keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search),
                    keyboardActions = KeyboardActions(onSearch = { searches += what to where }),
                )
            }
        }

        composeTestRule.onNodeWithText("What").requestFocus().assertIsFocused()
        composeTestRule.onNodeWithText("What").performTextInput("Coffee")
        composeTestRule.onNodeWithText("What").performImeAction()

        composeTestRule.onNodeWithText("What").assertIsNotFocused()
        composeTestRule.onNodeWithText("Where").assertIsFocused()

        composeTestRule.onNodeWithText("Where").performTextInput("Oslo")
        composeTestRule.onNodeWithText("Where").performImeAction()

        assertThat(searches).containsExactly("Coffee" to "Oslo")
    }
}
```

`requestFocus()` uses the node's focus semantics action, the same path an accessibility service takes. Use it to set up a test that starts with a focused field; use `performClick()` when the test is about tapping into the field.

## Password Fields

A field with `PasswordVisualTransformation` (or `SecureTextField`) carries the `Password` semantics property. Assert that marker, and assert the submitted value through the screen's callback rather than through the rendered characters.

```kotlin
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Button
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.assert
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextInput
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import com.google.common.truth.Truth.assertThat
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

@RunWith(RobolectricTestRunner::class)
class PasswordFieldTest {
    @get:Rule val composeTestRule = createComposeRule()

    @Test
    fun passwordIsMarkedSecretAndSubmitted() {
        val submitted = mutableListOf<String>()
        composeTestRule.setContent {
            var password by remember { mutableStateOf("") }
            Column {
                OutlinedTextField(
                    value = password,
                    onValueChange = { password = it },
                    label = { Text("Password") },
                    visualTransformation = PasswordVisualTransformation(),
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
                )
                Button(onClick = { submitted += password }) { Text("Log in") }
            }
        }

        composeTestRule.onNodeWithText("Password")
            .assert(SemanticsMatcher.keyIsDefined(SemanticsProperties.Password))
            .performTextInput("hunter2")
        composeTestRule.onNodeWithText("Log in").performClick()

        assertThat(submitted).containsExactly("hunter2")
    }
}
```

## TextFieldState-Based Fields

Material 3 also offers text fields that own a `TextFieldState` instead of a `value`/`onValueChange` pair (`TextField(state = ...)`, `OutlinedTextField(state = ...)`, `SecureTextField`). The same test actions work. Since the test can hold the state, it can also read `state.text` or prefill it.

```kotlin
import androidx.compose.foundation.text.input.TextFieldLineLimits
import androidx.compose.foundation.text.input.TextFieldState
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.ui.test.assertTextEquals
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performTextInput
import com.google.common.truth.Truth.assertThat
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

@RunWith(RobolectricTestRunner::class)
class NoteFieldTest {
    @get:Rule val composeTestRule = createComposeRule()

    @Test
    fun typesIntoAStateBasedField() {
        val state = TextFieldState(initialText = "Buy ")
        composeTestRule.setContent {
            OutlinedTextField(
                state = state,
                label = { Text("Note") },
                lineLimits = TextFieldLineLimits.SingleLine,
            )
        }

        composeTestRule.onNodeWithText("Note").performTextInput("milk")

        composeTestRule.onNodeWithText("Note").assertTextEquals("Note", "Buy milk")
        assertThat(state.text.toString()).isEqualTo("Buy milk")
    }
}
```

Prefer the semantics assertion; read `state.text` only when the test owns the state anyway (for example when the state is hoisted into a ViewModel under test).

## The Software Keyboard Under Robolectric

Robolectric has no input method, so no keyboard appears and `WindowInsets.ime` stays empty. `performTextInput` does not go through a keyboard: it calls the field's semantics actions. Consequences:

- Assert focus (`assertIsFocused`), not keyboard visibility. Calls to `LocalSoftwareKeyboardController.current?.hide()` run without error but have nothing to hide.
- Layout that reacts to the keyboard (`imePadding`) cannot be exercised here; cover it in an instrumented or screenshot test on a device.
- Hardware key events still work: `performKeyInput { pressKey(Key.Enter) }` (see [actions-gestures.md](../core/actions-gestures.md)).

## Anti-Patterns

| Anti-Pattern | Problem | Solution |
| --- | --- | --- |
| `assertTextEquals("ada@example.com")` on a labelled field | The label is part of the list; the assertion fails | `assertTextEquals("Email", "ada@example.com")` or `includeEditableText = false` for the label alone |
| `performTextInput` to overwrite or append to a prefilled field | Inserts at the cursor, which starts at 0 for a prefilled `String` field | `performTextReplacement`, or `performTextInputSelection` first |
| `onNodeWithTag("email_input")` when the field has a visible label | Hides a missing label | Find by label text |
| Asserting the keyboard is shown | No IME under Robolectric | Assert focus |
| `performImeAction()` without `keyboardOptions` | Fails: the field has no IME action | Set the action the product needs and test it |
| Asserting rendered bullets of a password field | Tests the transformation, not the contract | Assert the `Password` property and the submitted value |
| Typing one character at a time with sleeps | Slow; no timing to wait for | One `performTextInput` call |

## Related References

- **Finders and merged text**: [finders-semantics.md](../core/finders-semantics.md)
- **Text and state assertions**: [assertions.md](../core/assertions.md)
- **Key presses and focus traversal**: [actions-gestures.md](../core/actions-gestures.md)
- **Labels and error announcements**: [accessibility.md](accessibility.md)
- **Forms backed by a ViewModel**: [viewmodel-state.md](viewmodel-state.md)
