# u-journey-setup-grok-xhigh-cap Pi recapture report

## Status

**fail** for the linked pair (honest product mismatch). Cursor reuse still passes. Pi attempt `5bafa9a0` reached unlimited + role-confirm Other, then stopped without writing because `xai/grok-4.7` is not in detected models. Ledgers untouched. No commit.

## Attempt IDs

| Side | Attempt ID | Scorer |
| --- | --- | --- |
| cursor | `faeae5d9-c831-4b7b-9f47-abad3ed21433` | pass (reused) |
| pi | `5bafa9a0-d6f2-4bb3-b38f-66012dc305b1` | fail (`GROK_UNAVAILABLE`) |

Pair. `parity/evidence/setup-grok-xhigh-cap/pair-setup-grok-xhigh-cap-1.json`

## Pi drive (measured)

Harness change. Space-select unlimited (already focused), Enter, then Other on role-confirm (Down×2, Space, type, single Enter). Shortened Pi instruction to budget-apply style with an explicit Grok `:xhigh` cap and a stop-if-unavailable rule.

| Check | Result |
| --- | --- |
| Budget question reached | yes (`screen-01-question.txt`) |
| Unlimited selected | yes (`screen-01b-after-unlimited.txt`) |
| Role-confirm Other filled | yes (`screen-01d-after-role-other.txt`) |
| Wrote `# budget: unlimited (` | no |
| Grok at `:xhigh` after | 0 / 10 (rule unchanged fixture) |
| Agent stop reason | `xai/grok-4.7 isn't in the detected models` / no `xai/*` |
| After digest | `sha256:b8f73977…` (equals fixture) |
| Locked digest restored | `sha256:2b6b4668…` on Cursor + Pi rule paths |

Re-read `parity/evidence/setup-grok-xhigh-cap/pi/5bafa9a0-d6f2-4bb3-b38f-66012dc305b1/rule-after.mdc` and `screen-02-timeout.txt` / `screen-03-panel.txt`.

## Cursor (reused, not re-run)

Attempt `faeae5d9` remains 10/10 Grok→`xhigh-fast`, 9/9 Claude→`max`, aliases preserved. See prior report `u-journey-setup-grok-xhigh-cap-report.md`.

## Commands run

1. Confirmed locked digest `sha256:2b6b4668…` before capture.
2. Extended `parity/scripts/capture-setup-grok-xhigh-cap.mjs` (Pi unlimited-then-Other drive, shorter instruction, restore-on-error).
3. Ran `node scripts/capture-setup-grok-xhigh-cap.mjs --pi-only --pi-fixture=mixed` (log `capture-pi-mixed-6.log`).
4. Captured `GROK_UNAVAILABLE` with screens under attempt `5bafa9a0`.
5. Restored locked digest on both host rule paths after the throw.
6. Updated pair JSON and this report only. No ledger edits. No commit.

## Honest gaps

1. **Pair still fails.** Pi never wrote unlimited with Grok at `:xhigh`.
2. **Product gate.** Without `xai` in `/tmp/pi-ref-agent/auth.json`, Pi’s detected model list has no `xai/*`, so setup refuses to write Grok overrides. `models-store.json` still lists `grok-4.7`.
3. **Did not drop Grok** from `fixture-pi.mdc` to manufacture a pass.
4. **Prior c91e2ff6** refused dual AskQuestion Other instruction blobs. This run’s drive avoids that refuse path and surfaces the real availability wall instead.
5. **Closing Pi Grok-under-unlimited** needs xai auth (or another detected Grok-family slug) on the Pi agent dir, then a re-run of this capture.

## Scope not claimed

Does not close `PSTACK-SETUP-GROK-XHIGH-CAP-001` in ledgers. Coordinator owns merge. Worker acceptance is honest mismatch evidence with screens, not a green pair.

## Standing

Did not edit `requirements.json`, `mismatches.json`, or `progress.md`. Did not commit.
