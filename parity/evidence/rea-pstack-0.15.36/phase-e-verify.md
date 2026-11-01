# Phase E verify against Phase A predicate

Measured 2026-11-01 (pickup re-verify) against `@justjoshn/pi-pstack@0.15.36-pi.4` and tip `ae5650f` (pstack 0.15.36). Tip `origin/main` unchanged after fetch.

| Predicate clause | Result | Evidence |
| --- | --- | --- |
| 1 Inventory lock | PASS | tip HEAD = origin/main; REA digests poteto `ab08fdd8…`, statechart `2193bf21…`; `rea-deps/session-2026-11-01-refresh.md` |
| 2 No pstack dependency | PASS | RES-011 paths absent; `check-parity-predicate` no-upstream-sync; package never requires Cursor pstack install |
| 3 Skill/agent/automation coverage | PASS | 58/58 tip skills present; soft-deps present; team-kit soft-dep SKILL.md sha equal |
| 4 Host feature coverage | PASS | host-tools-registered check; durable supervisor bin; `host-feature-map.md` (durability closed) |
| 5 Executable parity | PASS | poteto/statechart trees vendored; REA 62/62 JS/TS re-analyzed this session (digests match 2026-10-31) |
| 6 Behavioral gate | PASS | vitest 38 files / 491 tests; `check-parity-predicate` PASS; gap-list 1–3 closed |
| 7 Out-of-scope disposition | PASS | CU cloud / enterprise recorded as `cursor-platform-out-of-scope-with-pi-substitute` in closure.md |

Harness: `node parity/scripts/check-parity-predicate.mjs` → `parity-predicate: PASS`.

**In-scope plugin parity.** Met.

**Residual (not Phase A blockers).** Host catalog model diversity; optional image model config; local worktree vs remote VM isolation strength (documented Pi substitute).
