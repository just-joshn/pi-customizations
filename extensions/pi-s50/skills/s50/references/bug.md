# Bug runs

Start with `s50 bug "<symptom>" [--consumer kind:path] [--criteria a;b]`. The run lands in `DIAGNOSE` (route skill `diagnosing-bugs`). After the root cause it moves `DIAGNOSE -> DOMAIN` and continues as in [feature.md](feature.md).

## The diagnostic exception

In DIAGNOSE you may record a feedback loop before any seam is confirmed. It is the only test-like artifact allowed ahead of seam confirmation, and it is temporary. List any temporary instrumentation you added for it.

```json
{"kind":"record_diagnostic","loop":{"id":"repro-1","kind":"failing_test","command":"bun run test -- parser","symptom":"TypeError on empty line","status":"red","promotedTo":null,"instrumentation":["console.error in split()"]}}
{"kind":"record_root_cause","cause":"split() yields an empty field for empty input"}
```

Loop kinds: `failing_test`, `http`, `cli_fixture`, `browser`, `trace_replay`, `throwaway_program`, `fuzz`, `bisect`, `differential`, `human_assisted`. A root cause needs a red loop.

## No feedback loop

If no red-capable loop can be built, do not guess the cause. Record what is missing:

```json
{"kind":"declare_inconclusive","missing":"access to the production queue"}
```

The run cannot advance while INCONCLUSIVE. Recording a red diagnostic loop in DIAGNOSE, or a `MEASURED` acceptance measurement through the consumer's method, resumes it.

## Promotion and the green reproducer

After CONFIRM_TDD_SEAMS confirms the permanent seam, promote the loop there. Remove the temporary instrumentation, apply the fix, and record the original reproducer green:

```json
{"kind":"promote_diagnostic","loopId":"repro-1","seamId":"seam-cli"}
{"kind":"record_diagnostic","loop":{"id":"repro-1","kind":"failing_test","command":"bun run test -- parser","symptom":"TypeError on empty line","status":"green","promotedTo":"seam-cli","instrumentation":[]}}
```

PR_READY needs a root cause, a loop promoted to a confirmed seam, every loop green, and no listed instrumentation.
