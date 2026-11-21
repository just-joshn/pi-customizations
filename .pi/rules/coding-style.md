# Coding Style

## Immutability

Create new objects instead of mutating existing ones:

```ts
// WRONG: Mutation
function updateUser(user: User, name: string): User {
  user.name = name
  return user
}

// CORRECT: Immutability
function updateUser(user: User, name: string): User {
  return { ...user, name }
}
```

## File Organization

Prefer small, cohesive files over large monoliths:
- High cohesion, low coupling
- 200-400 lines typical, 800 max
- Extract utilities from large modules
- Organize by feature or domain, not by type

## Error Handling

Handle errors at boundaries with context:

```ts
try {
  return await riskyOperation()
} catch (error) {
  throw new Error(`Operation failed: ${error instanceof Error ? error.message : String(error)}`, { cause: error })
}
```

## Input Validation

Validate external input at boundaries with `zod`:

```ts
import { z } from 'zod'

const schema = z.object({
  email: z.string().email(),
  age: z.number().int().min(0).max(150),
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
- [ ] No stray `console.log` statements
- [ ] No hardcoded values
- [ ] Immutable patterns used
