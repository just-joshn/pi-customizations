GOAL
Bridge the repaired acceptance verifier (write-confinement digest `5a33e1d4138283fe5d474cef5ccca575847e66e61f4a0c655ab6372106711aa7` from `/private/tmp/pi-pstack-parity-acceptance-owner`) into the main repo’s live-98 DRAFT acceptance tree so freeze preparation can use one coherent package. Do **not** freeze. Do **not** name an owner. Do **not** change live-98 definition/configuration oracle digests.

SCOPE
May write under main repo:
- `parity/acceptance/tools/**` (new — copy/adapt verifier+selftest)
- `parity/acceptance/review/**` (regressions as needed)
- `parity/research/acceptance-live98-verifier-bridge-001/`
- `parity/briefs/reports/u-acceptance-live98-verifier-bridge-001-report.md`
- `parity/briefs/u-acceptance-live98-verifier-bridge-001.md`
Must NOT edit ledgers (`requirements.json`, mismatches, dependencies, progress, source-lock, completion).
Must NOT change bytes of:
- `parity/acceptance/setup-pstack/definitions.json` (must stay `e576101783702498af089397c1fea80b8b688fd303a3ec78f8df5e6e66a1afe5`)
- `parity/acceptance/setup-pstack/configurations.json` (must stay `9eea368548c2d990e426c6a8466a0a8d03e98bd8436e639eaefa6d838a8d8a4e`)

CONTEXT
- Owner worktree tool (source of truth for confinement): `/private/tmp/pi-pstack-parity-acceptance-owner/parity/acceptance/tools/`
- Owner tree still hosts the historical 43-definition partition; main has live-98 DRAFT without tools
- Independent review flipped supporting-verifier-safe for the owner tool digest only (`u-acceptance-verifier-rereview-002`)
- After bridge, either (a) prove the bridged tool is byte-identical to `5a33e1d4…1aa7`, or (b) if adaptation for live-98 requires tool edits, document new digest and that supporting-verifier-safe must be re-reviewed before flip applies to the bridged copy
- Reference plugins: `/Users/josh-desktop/src/experiments/plugins` @ `ccb5507cec1546dc88135c1139c811e6c59115ba`
- Standing: orch preferences.md

ACCEPTANCE
- `parity/acceptance/tools/verify-acceptance.mjs` (+ selftest) present in main repo
- Live-98 defs/configs digests unchanged
- Selftest adapted for live-98 (or clearly scoped) and passes OR honest blockers documented
- Report states whether bridged tool digest equals `5a33e1d4…` or needs re-review
- No freeze; authorization NONE if verify runs
- No ledger edits

VERIFY
shasum live-98 files; run selftest; compare tool digest.

TIMEBOX
90 minutes.

FORBIDDEN
No ledger edits. No freeze. No inventing owner/custody. Do not spawn further subagents.

REPORT
`parity/briefs/reports/u-acceptance-live98-verifier-bridge-001-report.md`

STANDING
Obey orch preferences.md.
