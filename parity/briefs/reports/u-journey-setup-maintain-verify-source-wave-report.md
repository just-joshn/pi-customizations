# Report: maintain-verify source-wave pair

## Status

**pass** for `PSTACK-SETUP-MAINTAIN-VERIFY-SOURCE-WAVE-001`.

Pair `maintain-verify-source-wave-1`. Both hosts completed Pass steps 0–2 on a dedicated two-feature fixture, launched one read-only child per feature file, and returned summary / entry points / drift-or-none / live recipe on disk. Neither side wrote skill evidence from a drive during the wave.

## Attempts

| Host | Attempt ID | Marker | Children on disk |
| --- | --- | --- | --- |
| Cursor | `7d0f9dfd-9f01-4199-b783-64ac80d7552f` | `SOURCE_WAVE=done` | `hello-print.md`, `exit-zero.md` |
| Pi | `e3203616-b69f-4113-a036-8e664cfaca64` | `SOURCE_WAVE=done` | `hello-print.md`, `exit-zero.md` |

## Artifacts

- Pair: `parity/evidence/maintain-verify/pair-maintain-verify-source-wave-1.json`
- Capture script: `parity/scripts/capture-maintain-verify-source-wave.mjs`
- Fixture cwd: `parity/evidence/maintain-verify/fixture-app-source-wave` (not shared `fixture-app`)
- Markers: `fixture-out/source-wave/{cursor,pi}/source-wave.txt`
- Child returns: `fixture-out/source-wave/{cursor,pi}/children/`
- Decision log: `parity/evidence/maintain-verify/.audit/u-journey-setup-maintain-verify-source-wave.tsv`
- Pi session: `/tmp/pi-ref-agent/sessions/...fixture-app-source-wave.../2026-10-09T00-34-17-545Z_01a11e15-0949-7094-8b8c-8b31dabd15ae.jsonl`

## On-disk oracle (re-read)

Both markers are exactly:

```
SOURCE_WAVE=done
FEATURES=2
CONCURRENT_CHILDREN=yes
FIELDS=summary,entrypoints,drift,recipe
CHILDREN_DROVE=no
CHILDREN_EDITED=no
```

Cursor settled screen states two read-only explore subagents at the same time and four return fields each. Decoded PTY events contain `Running subagent` and `cursor · Task` chrome. Child files hold all four required sections. No `.cursor/evidence` directory exists under the fixture.

Pi settled screen states two concurrent read-only subagents and shows a finished explore agent notification for `exit-zero` (`c0dba4ac-...`). Session JSONL has two `subagent.started` events 111ms apart (`52ae0128-...` hello-print, `c0dba4ac-...` exit-zero). Child files hold all four sections. No `.pi/evidence` directory exists under the fixture.

## Honest gaps

- Capture prompt named the stop-after-source-wave contract and marker format. Agents still had to run maintain on a real PTY and produce children.
- Cursor concurrency is proven by PTY Task/Running-subagent chrome plus the settled narrative, not by a separate child-agent id ledger like Pi's session.
- Live pass, ship, and outcomes are not claimed. This pair stops after source wave by design.
- Model chrome differs (Cursor Opus 5.5 Medium vs Pi Sonnet 5.5 medium).

## Not claimed

- No ledger edits.
- No `pstack-models.mdc` writes.
- No commit.
- No LIVE-PASS, OUTCOMES, or SHIP close.
