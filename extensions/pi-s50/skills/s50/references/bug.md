# Bug runs

Start: `s50 bug "<symptom>" [--consumer kind:path] [--criteria a;b]`. The start lands in `DIAGNOSE` (route skill `diagnosing-bugs`), then `DIAGNOSE -> DOMAIN` and the feature path continues (see [feature.md](feature.md)).

## Diagnostic exception

In DIAGNOSE you may record a diagnostic loop before any seam is confirmed. This is the only test-like artifact allowed ahead of seam confirmation.

```json
{"kind":"record_diagnostic","loop":{"id":"d1","kind":"failing_test","command":"bun run test -t repro","symptom":"...","status":"red","promotedTo":null}}
```

Loop kinds: `failing_test`, `http`, `cli_fixture`, `browser`, `trace_replay`, `throwaway_program`, `fuzz`, `bisect`, `differential`, `human_assisted`.

## Root cause

Requires a `red` diagnostic loop:

```json
{"kind":"record_root_cause","cause":"..."}
```

## Promotion

After CONFIRM_TDD_SEAMS confirms a seam, promote the diagnostic into the permanent test at that seam:

```json
{"kind":"promote_diagnostic","loopId":"d1","seamId":"s1"}
```

PR-ready requires a root cause, a promoted diagnostic, and no diagnostic loop still `red`.
