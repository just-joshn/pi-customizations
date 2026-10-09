# Report: maintain-verify outcomes pair

## Status

**pass** for `PSTACK-SETUP-MAINTAIN-VERIFY-OUTCOMES-001`. Prefer-close **pass** for `PSTACK-SETUP-MAINTAIN-VERIFY-SHIP-001` on the clean/no-PR rule only.

Pair `maintain-verify-outcomes-1`. Both hosts ended a real PTY `/maintain-verification-skill` run with `OUTCOME=clean`, `PR=none`, and `BLOCKER=none`. That matches the SETUP definitions for clean (full coverage stated, nothing to ship, no branch or PR). It also matches SHIP for clean (no PR, outcome and coverage reported).

This pair does **not** reuse `create-verify/pair-create-verify-maintain-1.json`. That earlier Pi side reported `changed` without a PR, so it could not close SETUP-OUTCOMES.

## Attempts

| Host | Attempt ID | Outcome | PR |
| --- | --- | --- | --- |
| Cursor | `c3f0f75c-eb59-4cfc-b4e1-9495dc84e4e7` | `clean` | `none` |
| Pi | `d2597177-5cde-460b-8458-c2ee14b395d7` | `clean` | `none` |

## Artifacts

- Pair: `parity/evidence/maintain-verify/pair-maintain-verify-outcomes-1.json`
- Capture script: `parity/scripts/capture-maintain-verify-outcomes.mjs`
- Markers: `fixture-out/{cursor,pi}/maintain-outcome.txt`
- Decision log: `parity/evidence/maintain-verify/.audit/u-journey-setup-maintain-verify-outcomes.tsv`

## On-disk oracle (re-read)

Cursor marker is exactly:

```
OUTCOME=clean
PR=none
BLOCKER=none
```

Settled screen reports locate + source with no drift + live doctor/drive (`HELLO-FAMILY-13`, empty stderr, exit 0), no skill-dir edits, no branch, no PR.

Pi marker is the same three lines. Settled screen reports index match, source match via a direct `hello.sh` read, live doctor/drive with evidence under `.pi/evidence/verify-hello-cli/`, no edits, no branch, no PR.

## Honest gaps

- `changed` with a real PR path was not exercised. OUTCOMES/SHIP for the changed branch stay unpaid.
- `blocked` with a stated blocker was not exercised.
- Pi screen says it skipped concurrent source-wave children. Do **not** claim `PSTACK-SETUP-MAINTAIN-VERIFY-SOURCE-WAVE-001`.
- Live driving happened on both hosts in this run, but this pair does **not** claim `PSTACK-SETUP-MAINTAIN-VERIFY-LIVE-PASS-001` (full live-pass invariants and coordinator ownership stay for that sibling).
- Capture prompt named the allowed outcomes and marker format. Agents still had to run maintain on a real PTY and write the marker.

## Not claimed

- No ledger edits.
- No `pstack-models.mdc` writes.
- No commit.
- No SOURCE-WAVE or LIVE-PASS close.
