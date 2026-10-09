# Report: prin-exhaust-design pair

## Status

**pass** for `PSTACK-PRIN-EXHAUST-DESIGN-001` on both hosts. Pair `prin-exhaust-design-1`. Adjacent principle ids not claimed.

## Attempts

| Host | Attempt ID | Outcome |
| --- | --- | --- |
| Cursor | `c51f3304-680f-49c6-8b30-e387a5bbae7c` | Leaf Read + 3 prototypes + DECISION + `EXHAUST-OK` (`contractHeld`) |
| Pi | `b0270896-62fc-40a8-8f26-c29164b1976a` | Leaf Read + 3 prototypes + DECISION + `EXHAUST-OK` (`contractHeld`) |

## Artifacts

- Pair: `parity/evidence/principles/exhaust-design/pair-prin-exhaust-design-1.json`
- Capture script: `parity/scripts/capture-prin-exhaust-design.mjs`
- Fixture: `parity/evidence/principles/exhaust-design/fixture-app/`
- Cursor proof: `parity/evidence/principles/exhaust-design/fixture-out/cursor/evidence/verify-out.txt`
- Pi proof: `parity/evidence/principles/exhaust-design/fixture-out/pi/evidence/verify-out.txt`
- Capture log: `parity/evidence/principles/exhaust-design/capture-both.log`

## On-disk oracle (re-read)

Both hosts left ≥2 distinct `prototypes/` sketches with APPROACH lines, a `DECISION.md` with CHOSEN, shipped `src/picker.js`, and `EXHAUST-OK` under evidence. Cursor chose `stalest-first`; Pi chose `rule-table`. Leaf Reads evidenced; `disable-model-invocation: true`; `modelAutoInvoke` false.

## Honest gaps

- Prompt includes poteto-mode leaf-read nudge.
- Chosen approach ids differ across hosts (both satisfy 2–3 competing prototypes before commit).
- Model chrome differs.

## Not claimed

- Adjacent principle requirement closure beyond EXHAUST-DESIGN.
