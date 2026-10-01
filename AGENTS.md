# AGENTS.md

# Karpathy Coding Guidelines

Behavioral guidelines to reduce common LLM coding mistakes, derived from Andrej Karpathy's observations on LLM coding pitfalls. These principles bias toward caution over speed — for trivial tasks, use judgment.

## 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:

- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them — don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

## 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

## 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:

- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it — don't delete it.

When your changes create orphans:

- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

## 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:

- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:

```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

# Performance Rules

## Context Window Management

Avoid last 20% of context window for:

- Large-scale refactoring
- Feature implementation spanning multiple files
- Debugging complex interactions

## Algorithm Efficiency

Before implementing:

- [ ] Consider time complexity
- [ ] Avoid O(n^2) when O(n log n) possible
- [ ] Use appropriate data structures
- [ ] Cache expensive computations

# Coding Style Rules

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
import { z } from 'zod';

const schema = z.object({
    email: z.string().email(),
    age: z.number().int().min(0).max(150)
});

const validated = schema.parse(input);
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

# Testing Rules

## Minimum Test Coverage: 80%

Test Types (ALL required):

1. **Unit Tests** - Individual functions, utilities, components

## Test-Driven Development

MANDATORY workflow:

1. Write test first (RED)
2. Run test - it should FAIL
3. Write minimal implementation (GREEN)
4. Run test - it should PASS
5. Refactor (IMPROVE)
6. Verify coverage (80%+)

## Edge Cases to Test

Every function must be tested with:

- [ ] Null/undefined inputs
- [ ] Empty arrays/strings
- [ ] Invalid types
- [ ] Boundary values (min/max)
- [ ] Error conditions

## Test Quality Checklist

- [ ] Tests are independent (no shared state)
- [ ] Test names describe behavior
- [ ] Mocks used for external dependencies
- [ ] Both happy path and error paths tested
- [ ] No flaky tests

# Security Rules

## Mandatory Security Checks

Before ANY commit:

- [ ] No hardcoded secrets (API keys, passwords, tokens)
- [ ] All user inputs validated
- [ ] SQL injection prevention (parameterized queries)
- [ ] XSS prevention (sanitized HTML)
- [ ] CSRF protection enabled
- [ ] Authentication/authorization verified
- [ ] Rate limiting on all endpoints
- [ ] Error messages don't leak sensitive data

## Secret Management

```typescript
// NEVER: Hardcoded secrets
const apiKey = "sk-proj-xxxxx"

// ALWAYS: Environment variables
const apiKey = process.env.API_KEY
if (!apiKey) throw new Error('API_KEY not configured')
```

## Security Response Protocol

If security issue found:

1. STOP immediately
2. Fix CRITICAL issues before continuing
3. Rotate any exposed secrets
4. Review entire codebase for similar issues

## Scope

These instructions govern Vitest unit tests under this directory. Follow a nearer `AGENTS.md` or `AGENTS.override.md` when it provides more specific rules.

Use the current stable Vitest documentation as the source of truth for Vitest APIs and configuration. Follow the repository's existing package manager, test scripts, file layout, and `test` versus `it` convention. Do not invent project commands or change those conventions just to satisfy this file.

## Test behavior, not implementation

- Test the contract visible to callers: inputs, outputs, side effects, and errors.
- Do not assert private implementation details when the same behavior can be verified through the public contract.
- Keep each test focused on one behavior. Split tests whose names naturally describe several independent behaviors.
- Name tests after observable behavior, not internal methods or branches.
- Cover the main behavior first, then meaningful boundaries, error cases, and unusual valid inputs.
- When fixing a bug, add a regression test that reproduces the failure and passes with the fix.
- Prefer stable assertions over assumptions about incidental global state, generated IDs, test order, or execution timing.

## Structure tests for readability

- Use Arrange, Act, Assert as the natural test flow. Add section comments only when they improve readability.
- Keep `describe` nesting shallow. Omit `describe` when grouping adds no useful context.
- Split very large test files by behavior or feature rather than building deeply nested suites.
- Prefer `test.for` over Jest-compatible `test.each` in new parameterized tests.
- Prefer named case objects when parameterized cases contain enough positional values to become hard to read.
- Use `.only` only while developing locally. Never leave focused tests in the finished change.
- Use `.skip` and `.todo` only when the skipped or unfinished behavior is intentional and visible to maintainers.

## Keep tests independent

- Each test must be able to run by itself and in any order.
- Create fresh mutable state for each test unless sharing is an explicit part of the test design.
- Use `beforeEach` and `afterEach` for per-test setup and cleanup.
- Use `beforeAll` and `afterAll` only for resources intentionally shared across the suite.
- Scope hooks to the smallest relevant suite.
- Prefer `test.extend` fixtures for reusable setup and cleanup instead of coordinating shared mutable `let` variables through hooks.
- Keep fixtures test-scoped by default. Use broader scopes only when the resource is intentionally shared.
- Use `onTestFinished` when cleanup belongs next to the resource created inside the test.
- Clean up stubbed globals, environment variables, timers, servers, files, and other process-wide state.

## Test asynchronous code explicitly

- Prefer `async` and `await` for asynchronous tests.
- Await promise assertions such as `resolves` and `rejects`.
- Await all asynchronous work that must finish before the test completes.
- Use `expect.hasAssertions()` or `expect.assertions(n)` when callbacks, loops, branches, or promise chains could allow the test to finish without executing the intended assertions.
- Do not add assertion counting to straightforward tests that already use direct awaited assertions.
- Treat unhandled promise rejections as failures. Do not suppress them unless the rejection is intentional and handled by the test.
- Increase a timeout only when the operation is legitimately slow. Do not use larger timeouts to hide unfinished asynchronous work.
- Use fake timers when time is the dependency. Advance time explicitly and restore real timers after the test.

## Use precise assertions

- Choose the matcher that expresses the requirement most directly.
- Use `toBe` for primitive equality or reference identity.
- Use `toEqual` for structural equality.
- Use `toStrictEqual` when prototypes, types, sparse arrays, or explicit `undefined` values are part of the contract.
- Use `toBeCloseTo` for floating-point calculations.
- Prefer `toBeDefined` or another specific matcher over broad truthiness when the exact condition matters.
- Use `toMatchObject` or `toHaveProperty` when only part of an object is contractual.
- Pass a function to `toThrow` so Vitest can capture the thrown error.
- Use `expect.soft` only when the assertions are independent and collecting several failures is useful.

## Mock only at real boundaries

- Prefer real implementations when they are fast, deterministic, and safe.
- Mock dependencies around the subject under test. Do not mock the behavior the test is supposed to verify.
- Use `vi.fn()` to create a mock function.
- Use `vi.spyOn()` to observe or temporarily replace an existing method.
- Use `mockResolvedValue` and `mockRejectedValue` for asynchronous mocks.
- Use `vi.when()` when mock behavior depends on arguments instead of writing substantial argument-routing logic inside `mockImplementation`.
- For module mocks, use `vi.mock(import('./module.js'), factory)`, not a plain string module path.
- Remember that `vi.mock` is hoisted. Do not write module-mock setup that depends on normal source-order execution.
- Keep mock state from leaking between tests. Preserve the repository's cleanup configuration unless a change is required.
- Prefer global `restoreMocks: true` over repetitive `afterEach(() => vi.restoreAllMocks())` when the suite is sequential and the repository wants automatic spy restoration.
- Do not rely on global mock cleanup for async concurrent tests without checking for races. Automatic clear or restore operations can affect another test that is still running.
- Remember that `mock.calls` stores argument references, not snapshots. Assert before later mutation or capture the value explicitly when call-time state matters.
- For request mocking, use the repository's existing request-mocking approach. If choosing a Vitest-recommended approach for a new setup, use Mock Service Worker rather than handwritten network stubs.

## Keep snapshots intentional

- Use snapshots for stable, structured output when protecting the whole output is useful.
- Prefer targeted assertions when only a few fields or properties matter.
- Prefer inline snapshots for small focused values. Use external or file snapshots when the output is large enough that inline data hurts readability.
- Use snapshot property matchers for dynamic values such as IDs and timestamps.
- Review snapshot diffs before updating them. Never update snapshots only to make a failing test pass.
- Commit snapshot files that are part of the test contract.
- In concurrent snapshot tests, use the test-context `expect` so Vitest associates the snapshot with the correct test.

## Preserve safe parallelism and isolation

- Keep tests within a file sequential unless they are genuinely independent.
- Use `test.concurrent` for independent tests when concurrency provides a real benefit, especially for asynchronous waiting.
- Opt tests out of inherited concurrency when they use a shared resource that cannot overlap safely.
- Keep file parallelism enabled unless an external shared resource requires serialization.
- Do not disable parallelism globally to solve a problem that belongs to a small subset of tests. Isolate those tests or use a dedicated project when possible.
- Keep test-file isolation enabled unless the suite is proven safe to share a module graph.
- Before setting `isolate: false`, verify that affected tests do not mutate module-level state, stub globals or environment variables, patch prototypes, register long-lived process listeners, or require fresh module evaluation for mocks.
- If isolation is disabled for a unit-test project, run the suite with shuffling more than once to check for order-dependent state leaks.
- Do not change pools, worker counts, isolation, or parallelism only because a suite feels slow. Measure first. Use Vitest performance tooling such as `vitest doctor` when investigating runner performance.

## Coverage, environments, and TypeScript

- Use the V8 coverage provider unless the runtime or project requirements call for another provider. V8 is Vitest's default and recommended provider on supported V8 runtimes.
- Configure coverage to include untested source files when those files must appear in coverage results.
- Do not introduce an arbitrary coverage percentage as a Vitest requirement. Follow the repository's documented thresholds.
- Use the test environment that matches the APIs under test. Keep Node tests in `node`; use a DOM-capable environment only when the code requires DOM APIs.
- A normal Vitest run transforms TypeScript but does not replace TypeScript type checking. Run the repository's existing type-check command when type correctness is part of the change.
- Use Vitest type tests when the TypeScript type API itself is part of the contract.

## Verify the change without unnecessary work

- Start with the narrowest existing test command that exercises the changed behavior.
- Run the affected test file or affected unit-test set after the implementation is stable.
- Run the full test suite only when the change is broad, repository policy requires it, or narrower runs cannot establish confidence.
- Run existing type, lint, or coverage checks when the change affects those guarantees. Do not add unrelated checks to every task.
- Before finishing, confirm that no focused `.only` tests remain, expected cleanup runs, snapshots were reviewed, and failures caused by the requested change are resolved.