GOAL
Package live-98 DRAFT acceptance oracle digests into an operator-handoff custody bundle (immutable archive + verify script + exact grant steps for G3). Do not invent an owner. Do not freeze. Do not set acceptanceDefinitionsFrozen.

SCOPE
May write under `parity/research/acceptance-custody-pack-001/`, `parity/briefs/reports/u-acceptance-custody-pack-001-report.md`.
Must not edit ledgers (`requirements.json` frozen flags, owner fields, etc.).

CONTEXT
freeze-prep-002: 5 pass / 3 fail (independent owner, external custody, authorization). Digests `e5761017…` / `9eea3685…`. Verifier write-confinement PASS at `5a33e1d4…`. Same-user checkout is not external custody.
Standing: `/Users/josh-desktop/.claude/projects/-Users-josh-desktop-src-personal-pi-pstack-parity-again/pstack/orchestrate/pi-pstack-parity/preferences.md`.

ACCEPTANCE
- Custody pack with definitions.json + configurations.json byte-identical to live paths, MANIFEST with digests, verify script that fails if mutated.
- Operator steps: name independent owner ≠ implementation parent; place pack in external immutable store; authorize freeze transition.
- Explicit: this unit does not freeze and does not name an owner.
- Report only. Ledgers untouched.

VERIFY
shasum match live-98 paths. verify script PASS on pack, FAIL on mutated copy.

TIMEBOX
45 minutes.

FORBIDDEN
No ledger edits. No freeze. No invented owner. No further subagents. No commit required.

REPORT
parity/briefs/reports/u-acceptance-custody-pack-001-report.md

STANDING
Obey orch preferences.md.
