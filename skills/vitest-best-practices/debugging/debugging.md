# Debugging Failing Tests

## Table of Contents

1. [Debugging Workflow](#debugging-workflow)
2. [Reading the Failure](#reading-the-failure)
3. [Isolating the Test](#isolating-the-test)
4. [Logging and Output](#logging-and-output)
5. [Attaching a Debugger](#attaching-a-debugger)
6. [Debugging Browser Mode](#debugging-browser-mode)
7. [Trace View and Trace Timeline](#trace-view-and-trace-timeline)
8. [Vitest UI and HTML Report](#vitest-ui-and-html-report)
9. [Common Causes Checklist](#common-causes-checklist)

## Debugging Workflow

```
Test fails
├─ Read: header (file > suite > test), assertion message, diff, code frame
├─ Isolate: vitest run path/to/file.test.ts -t "name"  (or file:line)
│  ├─ Still fails alone → bug in test or code under test
│  └─ Passes alone      → state leak / order dependence → flaky-tests.md
├─ Need values?  → console.log, debug() for DOM, printConsoleTrace
├─ Need stepping? → --inspect-brk --no-file-parallelism --test-timeout=0
└─ Browser test?  → trace view (failure-only by default), headed browser
```

## Reading the Failure

A failure report has four parts:

- **Header**: `FAIL src/user.test.ts > createUser > sets the default role`, the full path in the test tree.
- **Assertion message**: which matcher failed and the two values.
- **Diff**: `-` lines are **expected**, `+` lines are **received**.
- **Code frame**: the failing line with a caret.

Then decide: did the code change intentionally (update the test) or is it a bug (fix the code)? Don't edit the expectation until you know which.

Tune the diff output when it's truncated or noisy with the [`diff`](../core/configuration.md) config option, and use `--expandSnapshotDiff` for full snapshot diffs.

## Isolating the Test

```bash
# One file
vitest run src/user.test.ts

# Tests whose full name matches (regex)
vitest run -t "sets the default role"

# File + name
vitest run src/user.test.ts -t "sets the default role"

# The test containing line 42 (full filename required, no ranges)
vitest run src/user.test.ts:42

# Stop after the first failure
vitest run --bail 1

# Rerun only tests that failed last run (5.1)
vitest run --last-failed
```

**Version note (5.x):** `-t` matches the full name joined with `' > '`, as shown in the reporter. `-t 'math adds'` no longer matches `describe('math') > test('adds')`. Use `-t 'math > adds'`, a single segment (`-t adds`), or a wildcard (`-t 'math.*adds'`).

`.only` works too. Remove it before finishing: CI defaults to `--allowOnly=false`, which fails runs that still contain `.only`.

```ts
import { expect, test } from 'vitest'

test.only('sets the default role', () => {
  expect(createUser({ name: 'Ada' }).role).toBe('member')
})
```

If a test passes alone but fails in the suite, go to [flaky-tests.md](flaky-tests.md).

## Logging and Output

`console.log` is fine for quick inspection. Vitest prints each log next to the test that produced it.

```bash
vitest run --reporter=verbose      # list every test, not just files
vitest run --printConsoleTrace     # print a stack trace with every console call
```

- `printConsoleTrace: true` tells you *where* an unexpected log or warning comes from.
- `onConsoleLog(log, type, entity)` in config can drop noisy third-party logs (return `false` to suppress).
- `logHeapUsage: true` prints heap usage after each test when chasing memory growth.
- In Browser Mode, `screen.debug()` from `vitest-browser-*` prints the rendered DOM.

```ts
// vitest.config.ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    printConsoleTrace: true,
    onConsoleLog(log, type) {
      return !(type === 'stderr' && log.includes('Download the React DevTools'))
    },
  },
})
```

## Attaching a Debugger

Breakpoints need tests in a single process and no timeout:

```bash
vitest run --inspect-brk --no-file-parallelism --test-timeout=0 src/user.test.ts
```

Then open `chrome://inspect` in Chrome, or attach from your IDE. The default port is `9229`; override with `--inspect-brk=127.0.0.1:3000`. In watch mode, `--isolate false` keeps the debugger attached across reruns.

### VS Code

Easiest: the official Vitest extension ("Debug Test" from the gutter or Testing view). Or run `vitest` in a **JavaScript Debug Terminal**. Or add a launch config:

```json
{
  "version": "0.2.0",
  "configurations": [
    {
      "type": "node",
      "request": "launch",
      "name": "Debug Current Test File",
      "autoAttachChildProcesses": true,
      "skipFiles": ["<node_internals>/**", "**/node_modules/**"],
      "program": "${workspaceRoot}/node_modules/vitest/vitest.mjs",
      "args": ["run", "${relativeFile}"],
      "smartStep": true,
      "console": "integratedTerminal"
    }
  ]
}
```

### JetBrains IDEs

WebStorm/IntelliJ have built-in Vitest run configurations. Set the working directory to the project root and run in debug mode.

## Debugging Browser Mode

```bash
# Debugger for browser tests
vitest --inspect-brk --browser --no-file-parallelism

# Watch a headed browser locally
vitest --browser.headless=false
```

- The official VS Code extension is the simplest route. For manual setup, use a compound launch config: a `node` launch running Vitest with `--inspect-brk --browser --no-file-parallelism`, plus a `chrome` attach on port `9229`.
- Run headed and open DevTools in the test iframe to inspect the DOM, console, and network.
- Locator failures print the page's ARIA tree in 5.x. Compare the roles and names you queried with what's actually there.
- **Version note (5.x):** the browser runner URL is session-bound (`/__vitest_test__/?sessionId=...`). Open the URL Vitest prints instead of a bare `/__vitest_test__/`.

## Trace View and Trace Timeline

**Browser tests (5.0+)**: `browser.traceView` records actions, `expect.element` assertions, and marks, with DOM snapshots. The default is `'failure-only'`: failed tests print a step timeline in the terminal and keep a snapshot of the page at failure.

```bash
vitest --browser.traceView                       # record every test
vitest --ui --browser.headless                   # view traces in Vitest UI
vitest run --reporter=html                       # traces in the HTML report (CI)
```

Add named steps to make traces readable:

```ts
import { page } from 'vitest/browser'

await page.mark('sign in flow', async () => {
  await page.getByRole('textbox', { name: 'Email' }).fill('ada@example.com')
  await page.getByRole('button', { name: 'Sign in' }).click()
})
```

Wrap shared helpers in `vi.defineHelper()` so their trace entries and errors point at the call site, not the helper's internals.

**Node tests (5.1, experimental)**: `experimental.traceTimeline: true` prints the `expect.poll`, `vi.waitFor`, and `vi.waitUntil` steps under a failure, showing what the test waited on and for how long. Give waits a `message` so the timeline names them:

```ts
import { vi } from 'vitest'

await vi.waitFor(() => server.ping(), { message: 'server started' })
```

## Vitest UI and HTML Report

```bash
npm i -D @vitest/ui
vitest --ui
```

**Version note (5.x):** the UI requires token auth. Open the URL Vitest prints, e.g. `http://localhost:51204/__vitest__/?token=...`. The bare `/__vitest__/` URL errors until the browser is authenticated.

The UI shows per-test output, errors, the module graph (useful for "why does this change break that test"), and browser traces. For CI, `--reporter=html` writes a static, read-only report to `.vitest/index.html` (preview with `npx vite preview --outDir .vitest`). It replaces the default terminal reporter unless you add the defaults back; see [reporters.md](../infrastructure-ci-cd/reporters.md).

## Common Causes Checklist

| Symptom | Likely cause | Where to look |
| --- | --- | --- |
| Passes alone, fails in suite | Shared state, unrestored spies, leaked globals | [flaky-tests.md](flaky-tests.md) |
| "unawaited assertion" failure | Missing `await` on `.resolves`/`.rejects`/`expect.poll` | [async-testing.md](../core/async-testing.md) |
| Timeout | Promise never settles, fake timers not advanced | [async-testing.md](../core/async-testing.md), [timers-dates.md](../mocking/timers-dates.md) |
| `document is not defined` | Running in `node` environment | [dom-environments.md](../testing-patterns/dom-environments.md) |
| Mock not applied | Hoisting, path mismatch, imported in setup file | [common-errors.md](common-errors.md) |
| Snapshot mismatch after intended change | Stale snapshot | Review diff, then `vitest -u` |

## Anti-Patterns to Avoid

| Anti-Pattern | Problem | Solution |
| --- | --- | --- |
| Debugging with the whole suite running | Slow, noisy, breakpoints hit in wrong worker | Isolate with path, `-t`, or `file:line` |
| `--inspect-brk` without `--no-file-parallelism` | Multiple workers; breakpoints unreliable | Add `--no-file-parallelism` |
| Stepping through code with the default 5s timeout | Test times out at the breakpoint | `--test-timeout=0` |
| Updating expectations to match received values | Hides real bugs | Decide: intended change or regression |
| `-t 'suite test'` with a space separator | No match in 5.x | `-t 'suite > test'` or a single segment |
| Leaving `.only` / `console.log` behind | CI fails (`allowOnly`), noisy output | Remove before finishing |
| Opening `/__vitest__/` directly | 5.x requires a token | Use the printed URL with `?token=` |
| Guessing why a locator didn't match | Wasted iterations | Read the ARIA tree in the error or the trace view |

## Related References

- [flaky-tests.md](flaky-tests.md) - order dependence, leaks, retries
- [common-errors.md](common-errors.md) - error messages and setup problems
- [async-testing.md](../core/async-testing.md) - awaiting assertions, `expect.poll`, `vi.waitFor`
- [browser-mode.md](../testing-patterns/browser-mode.md) - browser providers, headless, UI
- [annotations-filtering.md](../core/annotations-filtering.md) - `.only`, `-t`, tags
- [reporters.md](../infrastructure-ci-cd/reporters.md) - verbose, html, hanging-process
