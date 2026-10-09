# u-journey-family-02 report

## Status

**pass** for the capture brief. Linked Cursor+Pi pair recorded at one shared mixed-role fixture digest. One role mutated on both sides, the pre-pinned role stayed put, unrelated settings digests stayed equal, and a follow-up turn produced a MODEL-ID-CHECK line on both screens. Ledgers untouched. No commit.

## Attempt IDs

| Side | Attempt ID |
| --- | --- |
| cursor | `428e113d-8047-473a-aea6-3b632f080322` |
| pi | `6769d1c3-6f00-4528-85c5-7a251f30aeff` |

Pair. `parity/evidence/setup-rerun/pair-setup-rerun-mutate-role-1.json`

Fixture digest. `sha256:5f7e90885d37c4b9b7e2027755436f435f8fba765f74c3c92373bb30d0bc9d9b` (identical in both identity.json fixtureRef fields)

After-rule digest. `sha256:e53304ff0b95d65445b40d1c131f047efeda60d7399dc4b3fdc37293d90d5e32` (identical rule-after.mdc bytes on both sides)

## Observed journey

Fixture. Locked all-inherit-parent rule with `bug-fix` rewritten to `auto` before launch (`parity/evidence/setup-rerun/fixture-mixed.mdc`). Budget stayed `small (medium)`.

### Role mutation

Measured from `rule-before.mdc` vs `rule-after.mdc` and the write-card screens.

| Check | Cursor | Pi |
| --- | --- | --- |
| `feature, refactoring` inherit-parent → auto | yes | yes |
| `bug-fix` stayed auto | yes | yes |
| Other roles unchanged | 16 | 16 |
| Budget unchanged | small (medium) | small (medium) |
| Write card `Edited pstack-models.mdc +1 -1` | yes | yes |

Cursor drove the mutation through a chat-form free-text instruction. Pi used AskQuestion Other with the same instruction and still wrote the same single-line diff.

### Unrelated settings unchanged

| Artifact | Before | After | Unchanged |
| --- | --- | --- | --- |
| `parity/evidence/setup-rerun/canary-unrelated-settings.json` | `sha256:cf5fbc82…` | `sha256:cf5fbc82…` | yes |
| `/tmp/pi-ref-agent/settings.json` | `sha256:f91ec6fb…` | `sha256:f91ec6fb…` | yes |

### Follow-up model identity

Cursor screen `screen-05-followup-reply.txt` line. `MODEL-ID-CHECK Auto` (status chrome also shows Auto).

Pi screen `screen-05-followup-reply.txt`. Assistant wrote a MODEL-ID-CHECK line that declined a concrete slug. Status chrome on the same screen shows `(claude-subscription) claude-sonnet-5-5 • medium`. Identity for Pi is taken from that status line, not the weak self-report.

### New-session guidance

Both write completions stated the rule applies to new sessions (Cursor screen-05; Pi screen-05 / after-write prose). That is the observable surface for `PSTACK-SETUP-NEW-SESSION-APPLIES-001` in this pair. No second session was launched.

## Commands run

1. Confirmed locked reference digest `sha256:2b6b4668…` on `~/.cursor/rules/pstack-models.mdc` and `/tmp/pi-ref-agent/pstack/models.mdc`.
2. Wrote `parity/scripts/capture-setup-rerun.mjs`.
3. Ran `node scripts/capture-setup-rerun.mjs --cursor-only`, then `--pi-only`.
4. Re-read pair identities, both rule-after digests, canary and settings digests, and follow-up screens.
5. Restored locked rule digest after each side (verified `sha256:2b6b4668…` after the run).

## Deviations

1. Fixture digest is the mixed-role pre-state (`5f7e9088…`), not the locked all-inherit-parent digest. Pair equality still holds.
2. Pi AskQuestion path emitted extra panel screen dumps (`screen-02-panel` … `screen-06-panel`) before the write card. Cursor stayed on the chat-form path.
3. Pi follow-up self-report did not name `claude-sonnet-5-5`. Status line did. Report treats status chrome as the Pi identity observation.
4. `PSTACK-SETUP-PANEL-LIST-FANOUT-001` is only lightly touched (panel roles stayed inherit-parent lists of length 1 via alias). No fan-out length change was attempted.
5. Did not edit `requirements.json`, `mismatches.json`, or `progress.md`.
6. Did not commit.

## Suggested follow-ups for the coordinator

1. Merge this pair into the family stub and requirement evidence rows for the preserve / guide-keep / role-confirm / budget-apply / new-session items.
2. Decide whether Pi status-chrome identity is enough for `PSTACK-SETUP-NEW-SESSION-APPLIES-001` follow-up routing, or whether a second session that spawns a Task under `feature, refactoring` is required.
3. Optional. Capture a fan-out length change for `PSTACK-SETUP-PANEL-LIST-FANOUT-001` as its own pair.
