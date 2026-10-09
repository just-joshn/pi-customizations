# u-journey-family-03 report

## Status

**partial.** First linked Cursor+Pi pair for journey family 03 captured on real PTY. Covers `/setup-pstack` unanswered cancel and `/poteto-help` on both sides at locked fixture digest. Cancel chrome and help skill recommendation differ across hosts. Honest deltas recorded. Ledgers untouched. No commit.

## Attempt IDs

| Side | Attempt ID |
| --- | --- |
| cursor | `d20bff6f-9012-4d81-a1dc-cccd7202c4b8` |
| pi | `e6909603-6d1f-4828-a1f2-d9f2d6d0be4c` |

Pair. `parity/evidence/commands/pair-commands-help-cancel-1.json`

Fixture digest. `sha256:2b6b4668aab2c08758d602531426082a3d4a25d8eeb2104b963cbf35255f6004` (both sides `ruleUnchanged: true`, afterDigest identical)

## Observed cancel behavior

### Cursor (reference)

Measured from `screen-01-question-unanswered.txt` through `screen-03-after-cancel-settled.txt`.

1. `/setup-pstack` ran the skill and explored AskQuestion MCP tools.
2. No Clarifying Questions panel. Agent asked in freeform chat for a reasoning budget (numbered unlimited/large/medium/small).
3. Escape did not clear that question from the transcript. Composer returned to follow-up.
4. Rule file digest stayed at the locked fixture. Cancel as no-write is VERIFIED. Panel-parity cancel is NOT VERIFIED on this host build.

### Pi (adaptation)

Measured from `screen-01-question-unanswered.txt` through `screen-03-after-cancel-settled.txt`.

1. Clarifying Questions panel opened with `› [ ]` options and `Esc to skip`.
2. Escape produced `Questions skipped by user`.
3. Agent said it did not write anything and the rule was unchanged.
4. Rule digest stayed at the locked fixture. Panel cancel is VERIFIED.

## Observed help behavior

Prompt on both sides. `/poteto-help which skill should i use to review this branch?`

### Cursor

From `screen-06-help-settled.txt`.

1. Read interrogate skill and poteto-help prompting reference.
2. Recommended `/interrogate` with a copyable prompt and GitHub source path.
3. Did not start the review run on the help turn.
4. No `Used poteto-help` chrome on this CLI screen.

### Pi

From `screen-06-help-settled.txt`.

1. Showed `[skill] poteto-help`.
2. Recommended `/review-and-ship`, with `/interrogate` and `/blast-radius` as narrower alternatives, plus a copyable example prompt and source link.
3. Did not run the recommended skill on the help turn.

Help-vs-work (answer + prompt, no work started) is VERIFIED on both sides. Skill choice parity is NOT VERIFIED. Recommendation strings diverge.

## Commands run

1. Confirmed locked fixture digest on `~/.cursor/rules/pstack-models.mdc` and `/tmp/pi-ref-agent/pstack/models.mdc`.
2. Wrote and iterated `parity/scripts/capture-commands-help-cancel.mjs` (cancel first, then help; freeform budget needles after Clarifying Questions stopped appearing on Cursor).
3. Ran `--both` to completion. Re-read screens, identities, rule-after digests, and Pi session `2026-10-08T18-16-18-619Z_01a11cba-fbba-73ba-be07-db629cab5412.jsonl`.

## Deviations

1. Three Cursor attempts discarded before the linked pair. Help-first ordering and Clarifying-Questions-only waits failed. Details in the pair JSON `discardedAttempts`.
2. Cursor cancel chrome on this run is freeform budget text, not the Clarifying Questions panel seen in `pair-setup-escape-cancel-2.json`. Not silently reconciled.
3. Pi help recommended `/review-and-ship`; Cursor recommended `/interrogate` for the same question. Not silently reconciled.
4. Did not edit `requirements.json`, `mismatches.json`, or `progress.md`.
5. Did not commit.

## Suggested follow-ups for the coordinator

1. Decide whether Cursor freeform budget ask is a regression vs Clarifying Questions for `PSTACK-SETUP-CANCEL-NO-WRITE-001`, or an accepted host binding.
2. Record a mismatch or piBinding for poteto-help skill routing if the oracle expects one canonical recommendation.
3. Expand family 03 to remaining registered slash commands (invalid args per command, NL triggers).
