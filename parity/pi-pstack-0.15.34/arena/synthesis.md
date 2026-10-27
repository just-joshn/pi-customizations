# Synthesis — pi-pstack 0.15.30 → 0.15.34

## Synthesis decision

**Base: Candidate 1** (lazy tip pin, full corpus, no proactive host map). Agrees with [arena cross-judge designs](1c354806-c466-4f48-908a-a50443431603) totals 29 / 26 / 21.

Why. User goal is 100% parity with latest pstack. Tip `519d36aa` + unchanged `targetFor` keeps SOURCE+lock as the only ship registry. Candidate 3’s EXCLUDE fails that goal. Candidate 2’s proactive host maps raise prompt surface without a proven gap and softens RED-first.

## Grafts

- From Candidate 2. SCRIPT-001 depth against `skills/statechart/scripts/statechart` usage/exit contract, plus mise/TLC first-run documentation in Limits/README. Optional TLC-gated upstream suite is confirm evidence, not the RED unit latch.
- From Candidate 3. Explicit presence assertions that `skills/statechart/scripts/statechart.ts` and `skills/ketchup-video/SKILL.md` ship, next to count pins.
- Host-map lines for ketchup-video / reflect. Only if a HOST or confirm test fails and names the gap (`HostMapChange.kind === 'sections-line'`).

## Rejected

- Candidate 3 EXCLUDE / bump-only pin / subset “parity.”
- Candidate 2 proactive `sections.ts` lines and GREEN-before-RED next step.
- Package-gate-only verification. Hand edits to lock targets. Pi video renderer.

## Chosen shape (executable)

1. Pin `SOURCE` to `519d36aa98955bf680db01bcde5fdfba686dc901` / `0.15.34` / team-kit `1.2.0`.
2. Keep `targetFor` unchanged. Ship full corpus (579 files after sync).
3. RED count pins first. Then SOURCE move. Then `sync:upstream` GREEN.
4. Rewrite SCRIPT-001 for the `statechart` shell entry. Refresh poteto pass counts from one green run.
5. Docs/`package.json` → `0.15.34-pi.1`. Limits note for mise/TLC first-run.
6. `typecheck` + `test` → control-pi confirm → `live:e2e` → independent sha256 fact-check.
7. Archive under `parity/pi-pstack-0.15.34/`.

## Domain structure

`SourcePin` + `upstream.lock.json` + `ExpectedCounts` derived from `ls-tree` ⊕ `targetFor`. `BumpPlan` phases as ordered ladder. No third registry.

## Next implementation step

Derive exact transform histogram via a tip-pinned dry `buildPlan`, write RED pins in `resources.test.ts` / e2e, run until fail, then move SOURCE and sync.
