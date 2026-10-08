# u-mode-one-message report

## Status

**partial.** Linked Cursor+Pi pair captured at locked fixture digest. Cursor plain Enter did not leave sticky Custom Mode chrome across the follow-up turn. Pi `/poteto-mode` + Enter turned sticky session mode on (crown badge) and kept it through the follow-up. Cursor never showed `Used poteto-mode` attachment chrome, so one-message skill attach is observed only as non-sticky follow-up behavior, not as a `Used` badge. Ledgers untouched.

## Attempt IDs

| Side | Attempt ID |
| --- | --- |
| cursor | `5fd487a4-cf8e-4fe4-bbc0-7de39af1a159` |
| pi | `bb7c8cd9-1fdd-43fe-aeb9-c0cc805f435b` |

Pair. `parity/evidence/mode-one-message/pair-mode-one-message-1.json`

Fixture digest. `sha256:2b6b4668aab2c08758d602531426082a3d4a25d8eeb2104b963cbf35255f6004` (identical; both `ruleUnchanged: true` by afterDigest)

## Observed one-message vs sticky behavior

### Cursor (reference)

Measured from screens in the cursor attempt dir.

1. Slash menu. Typing `/poteto-mode` selected `/poteto-mode` in the menu (`screen-01-slash-menu.txt`).
2. Plain Enter. Menu closed. Composer kept `→ /poteto-mode`. No Custom Mode chrome (`screen-02-after-plain-enter.txt`).
3. First turn. Submitted `/poteto-mode` plus the three-word task. Assistant replied `one message only`. No `Used poteto-mode`, no Custom Mode badge (`screen-05-after-first-turn.txt`).
4. Follow-up. Ordinary message without re-selecting the skill. Assistant replied `4`. Still no Custom Mode chrome (`screen-07-after-second-turn.txt`).

Conclusion for Cursor. Plain Enter did not activate persistent mode for the next user turn. That matches the forbidden side effect in `PSTACK-MODE-ONE-MESSAGE-001`. Attachment chrome (`Used poteto-mode`) was absent on this CLI build, so "skill attaches to one message" is only supported indirectly by the non-sticky follow-up.

### Pi (adaptation)

Measured from screens in the pi attempt dir and the session transcript.

1. Submitted `/poteto-mode` plus the same first task with plain Enter.
2. Screen showed `[skill] poteto-mode` and status `👑 Poteto Mode` immediately (`screen-02-after-plain-enter.txt`).
3. After the follow-up reply `4`, the crown badge was still present (`screen-05-after-second-turn.txt`).

Conclusion for Pi. The same literal `/poteto-mode` + Enter path enables sticky session-branch mode and keeps it across the next user turn. That is the documented Pi mapping (`/poteto-mode` sticky; `/skill:poteto-mode` claimed as one-message in help text). It is the opposite of Cursor plain-Enter one-message semantics for this trigger.

Session. `/tmp/pi-ref-agent/sessions/--Users-josh-desktop-src-personal-pi-pstack-parity-again-parity-fixtures-first-run--/2026-10-08T17-41-40-500Z_01a11c9b-4614-7364-b346-98eef49423b4.jsonl`

## Commands run

1. Confirmed fixture digests on `~/.cursor/rules/pstack-models.mdc` and `/tmp/pi-ref-agent/pstack/models.mdc` equal `sha256:2b6b4668…`.
2. Wrote and ran `parity/scripts/capture-mode-one-message.mjs --both`, then `--cursor-only` after fixing settle waits (first Cursor attempt raced the follow-up while still Working).
3. Re-read attempt screens, identities, rule-after digests, and the Pi session path above.

## Deviations

1. First Cursor attempt `d40605ed-…` superseded. Follow-up was typed while the spinner was still up. Retained as race evidence only.
2. Option+Enter probe (`\x1b\r`) during harness design did not select Custom Mode from the slash menu. Sticky comparison used Pi's crown badge, not a Cursor Option+Enter pair (that belongs to `PSTACK-MODE-STICKY-001`).
3. Did not edit `requirements.json`, `mismatches.json`, or `progress.md`.
4. Did not commit.

## Suggested follow-ups for the coordinator

1. Record a mismatch or piBinding for plain-Enter `/poteto-mode` if the oracle expects Cursor one-message semantics on Pi. Pi currently sticks.
2. Capture `PSTACK-MODE-STICKY-001` with a verified Option+Enter / Alt+Enter byte sequence on Cursor CLI, then pair against Pi sticky.
3. Optionally probe `/skill:poteto-mode` on Pi as the one-message counterpart named in poteto-help (code currently also calls `store.toggle(true)` on that path; verify before trusting the help text).
