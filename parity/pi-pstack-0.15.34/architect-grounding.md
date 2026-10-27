# Grounding for pi-pstack 0.15.30 → 0.15.34 design

## Done predicate
pi-pstack pins latest pstack 0.15.34 + team-kit 1.2.0 deps; every shipped file matches after declared transforms; host stays Pi-native; user behavior verify → confirm → fact-check all PASS on real Pi surface. Work only in worktree `/Users/josh-desktop/src/personal/pi-customizations-wt/pi-pstack-0.15.34`.

## How summary (f757ff3e)
- Two layers: sync-upstream.mjs vendoring + src/ Pi host.
- Mechanical bump: RED count pins → SOURCE move → sync GREEN → check → typecheck/test → control-pi/live → independent sha256 fact-check.
- Counts at 0.15.34 (targetFor): 579 files, 61 one-seg skills, 57 hidden, 62 loaded (+create-skill). Team-kit unchanged 1.2.0.
- 164ced1 (version bump) and 519d36a (HEAD) have identical targetFor sets; HEAD adds upstream statechart test wait only.
- New: ketchup-video skill; statechart mjs→TS + large corpus (+~407 paths).
- Patch worktree-audit-pi-transcripts still applies.
- SCRIPT-001 statechart.mjs tests obsolete; poteto pass counts may be stale.

## Design forks to settle
1. Pin commit: 164ced1 vs 519d36a.
2. Ship full statechart corpus via current targetFor vs filter tests/corpus out.
3. ketchup-video / reflect host map: none vs Skipped-in-Pi line vs proactive video/path map in sections.ts.
4. Verification depth: package gate only vs full 0.15.30 confirm+fact-check ladder (user required the full ladder).

## Constraints
- 100% parity in Pi-native way (user).
- No hand edits to vendored lock targets.
- Laziness Protocol: smallest change that solves.
- Model the domain: SOURCE + lock remain registry of truth.

## Count correction
Real `targetFor` ships all `pstack/docs/**` (not only guide), including `docs/harness/claude-code.md`. Locked file count at tip: **579** (not 578).
