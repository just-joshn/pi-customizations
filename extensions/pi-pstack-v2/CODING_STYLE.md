# Coding Style Rules

These are the only style rules for `extensions/pi-pstack-v2`. They apply to every code file in the folder, tests included. The only exception is a spot where following a rule would change functionality or behavior. Each such spot is listed, with its reason, in `scripts/style/behavior-exceptions/*.json` (one file per area).

## Immutability (CRITICAL)

ALWAYS create new objects, NEVER mutate:

```javascript
// WRONG: Mutation
function updateUser(user, name) {
  user.name = name  // MUTATION!
  return user
}

// CORRECT: Immutability
function updateUser(user, name) {
  return { ...user, name }
}
```

## File Organization

MANY SMALL FILES > FEW LARGE FILES:
- High cohesion, low coupling
- 200-400 lines typical, 800 max
- Extract utilities from large components
- Organize by feature/domain, not by type

## Error Handling

ALWAYS handle errors comprehensively:

```typescript
try {
  const result = await riskyOperation()
  return result
} catch (error) {
  console.error('Operation failed:', error)
  throw new Error('User-friendly error message')
}
```

## Input Validation

ALWAYS validate user input:

```typescript
import { z } from 'zod'

const schema = z.object({
  email: z.string().email(),
  age: z.number().int().min(0).max(150)
})

const validated = schema.parse(input)
```

## Code Quality Checklist

Before marking work complete:
- [ ] Code is readable and well-named
- [ ] Functions are small (<50 lines)
- [ ] Files are focused (<800 lines)
- [ ] No deep nesting (>4 levels)
- [ ] Proper error handling
- [ ] No console.log statements
- [ ] No hardcoded values
- [ ] Immutable patterns used

## How the gate checks these rules

Run `node scripts/style-audit.mjs`. It exits 0 only when every file passes.

| Rule | Check |
| --- | --- |
| Immutability | `scripts/style/immutability.grit`: no property or index assignment, compound assignment, `++`/`--` on a member, `delete`, mutating array/Map/Set method, `Object.assign` onto an existing object, `Object.defineProperty`, `Reflect.set`/`deleteProperty`/`defineProperty` |
| Files under 800 lines | line count in `style-audit.mjs` |
| Functions under 50 lines | Biome `noExcessiveLinesPerFunction`, 47 body lines max, every function and callback |
| Nesting at most 4 levels | indentation depth in `style-audit.mjs` |
| Error handling | `scripts/style/error-handling.grit`: every `catch` logs the error with `console.error` and throws an `Error`; Biome `noEmptyBlockStatements`, `noUselessCatch`, `useErrorMessage`, `useThrowOnlyError`, `noCatchAssign`, `noFloatingPromises`, `noMisusedPromises` |
| Input validation | `scripts/style/input-validation.grit`: `JSON.parse`, `process.argv`, and `process.env` go straight into a zod `.parse`/`.safeParse`; every tool `execute` and command `handler` parses its input with zod; no schema is a bare `z.unknown()`/`z.any()` |
| No console.log | Biome `noConsole` |
| No hardcoded values | Biome `noMagicNumbers`; `scripts/style/hardcoded-values.grit` for URL and path strings outside a named `const` |
| No silencing | a `biome-ignore` comment naming any of these rules fails the gate |

An entry in `scripts/style/behavior-exceptions/` excuses exactly one violation: one source line, matched by its trimmed text, for one rule. Two identical lines need two entries. An entry that no longer matches a violation fails the gate.
