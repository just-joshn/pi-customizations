# Arena cross-judge — pi-pstack 0.15.30 → 0.15.34

Readonly scoring of three design candidates against the six-criterion rubric. Grounding: `architect-grounding.md` (done predicate = tip 0.15.34 + team-kit 1.2.0, SOURCE+lock registry, full confirm+fact-check ladder, worktree-only).

## Scores

Scale: 0–5 integers. Evidence is one line per cell.

### Candidate 1 — Laziest full-parity (tip pin, full corpus, no proactive host map)

| # | Criterion | Score | Evidence |
|---|-----------|------:|----------|
| 1 | Parity fidelity | 5 | Tip `519d36aa` + unchanged `targetFor` → 579 lock files; no second ship policy; matches grounding “latest + every shipped file after transforms.” |
| 2 | Domain registry | 5 | SOURCE + lock only; forbids hand edits; leaves `targetFor` verbatim; no EXCLUDE registry. |
| 3 | Host boundary | 4 | No speculative tools / no vendored edits; relies on existing Skipped-in-Pi + ketchup image — reflect `.cursor/skills` install paths left unmapped until a failing test. |
| 4 | Interface depth | 5 | Bump surface = SOURCE + pins/docs + SCRIPT-001 rewrite; ≤3 hops; sync complexity stays inside `sync-upstream.mjs`. |
| 5 | Verification ladder | 5 | Explicit frame→RED→GREEN→script→docs→verify→confirm→fact-check; independent sha256 re-derive; next step is RED-first. |
| 6 | Maintainer extensibility | 5 | Settled policy: tip pin, full corpus, host map only on proven gap — future bumps reuse the machine without re-arguing filter or proactive maps. |
| | **Total** | **29** | |

### Candidate 2 — Host-complete tip pin (tip pin, full corpus, proactive video+reflect map)

| # | Criterion | Score | Evidence |
|---|-----------|------:|----------|
| 1 | Parity fidelity | 5 | Same tip + full 579 `targetFor` set as C1; host-map lines adapt runtime, do not fork ship truth. |
| 2 | Domain registry | 5 | SOURCE + lock sole ship registry; no hand edits; full corpus; no EXCLUDE. |
| 3 | Host boundary | 5 | ketchup-video → Skipped-in-Pi + mermaid/ketchup fallback; reflect install → `.pi/skills` / `$PI_AGENT/skills`; no video tool; no vendored-text edits. |
| 4 | Interface depth | 4 | Sync surface stays deep, but every bump now carries mandatory `sections.ts` + HOST e2e line work for Cursor concepts. |
| 5 | Verification ladder | 4 | Design states full RED→…→fact-check, but “Next implementation step” starts at SOURCE/sync (GREEN-first), softening the mandatory RED latch. |
| 6 | Maintainer extensibility | 3 | “Host-complete” precedent forces re-arguing proactive map lines for each new Cursor-only skill concept on future bumps. |
| | **Total** | **26** | |

### Candidate 3 — Lean filter + bump pin (bump pin, EXCLUDE statechart scripts/test, minimal host map)

| # | Criterion | Score | Evidence |
|---|-----------|------:|----------|
| 1 | Parity fidelity | 2 | Pins `164ced1` not tip; EXCLUDE (~203 vs 579) invents a second shipping truth and redefines parity as “user-facing” vs grounding’s full `targetFor` match. |
| 2 | Domain registry | 5 | EXCLUDE declared beside SOURCE, applied inside `targetFor`, asserted in tests; lock remains exact shipped set; no post-sync `rm`. |
| 3 | Host boundary | 4 | Zero `sections.ts` edits; existing Skipped-in-Pi + ketchup image; no tools/vendored edits — same reflect-install gap risk as C1. |
| 4 | Interface depth | 3 | Maintainer must learn SOURCE **and** EXCLUDE; `targetFor` grows a policy arm; open question whether EXCLUDE expands later. |
| 5 | Verification ladder | 5 | RED→EDIT→SYNC→GREEN→GATE→LIVE→FACT spelled out; idempotent sync/check; fact-check mandatory. |
| 6 | Maintainer extensibility | 2 | Future bumps re-argue tip-vs-bump and what counts as “non-runtime fixture” vs ship — design’s own open question. |
| | **Total** | **21** | |

## Totals

| Candidate | Total |
|-----------|------:|
| 1 — Laziest full-parity | **29** |
| 2 — Host-complete tip pin | **26** |
| 3 — Lean filter + bump pin | **21** |

## Recommended base

**Candidate 1.**

It is the only design that simultaneously satisfies the user’s 100% / latest parity goal (tip + full `targetFor`), keeps SOURCE+lock as the sole ship registry without a filter fork, and freezes bump policy so the next pin move is mechanical. C2 ties on ship fidelity but pays interface and extensibility cost for proactive host lines, and softens RED-first in its next step. C3’s structural EXCLUDE is well-engineered domain work, but it fails the parity criterion the arena was convened to meet.

## Graft from losers

- **From C2 (conditionally):** SCRIPT-001 depth — shell entry help/usage contract, mise/TLC first-run documentation assertions, and optional `TLA2TOOLS`-gated upstream `node --test` — more concrete than C1’s missing-SPEC-only sketch.
- **From C2 (only if proven):** reflect install destination mapping (`.cursor/skills` → `.pi/skills` / agent skills) and a ketchup-video Skipped line — graft **after** a failing HOST/confirm test names the gap, matching C1’s `HostMapChange.kind === 'sections-line'` latch (not up front).
- **From C3 (lightly):** explicit lock assertions that named runtime paths **do** ship (`statechart.ts`, `ketchup-video/SKILL.md`) alongside count pins — strengthens C1’s ExpectedCounts without adopting EXCLUDE.

## Reject from losers

- **C3:** `EXCLUDE` / corpus filter; bump-only pin `164ced1`; redefinition of parity as user-facing subset; exposing EXCLUDE as a permanent bump dial.
- **C2:** Proactive video + reflect host-map lines without a RED host test; GREEN-before-RED “next step” ordering; any implication that every Cursor concept must get a `sections.ts` bullet on the same bump.
- **Both losers:** Package-gate-only shortcuts (already rejected by all three — keep rejected). Hand-edits to lock targets or vendored skill text (already rejected — keep rejected). Pi video renderer / new video tool surface.
