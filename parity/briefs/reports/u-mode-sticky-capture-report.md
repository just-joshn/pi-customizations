# u-mode-sticky-capture report

## Status

**partial.** Pi sticky verified with `/poteto-mode sticky`. Crown stayed through the follow-up turn. Cursor Option+Enter / Alt+Enter sequences did not enter Custom Mode in the PTY harness. Pair JSON published. Ledgers untouched. No commit.

## Attempt IDs

| Side | Attempt ID |
| --- | --- |
| Pi | `96494327-f90c-470a-8e11-cf7c5b6cad89` |
| Cursor | `9a6e00d0-b7c7-43c1-b09a-7a2db3209dc7` |

Fixture digest both sides. `sha256:2b6b4668aab2c08758d602531426082a3d4a25d8eeb2104b963cbf35255f6004`

Pair. `parity/evidence/mode-sticky/pair-mode-sticky-1.json`

## Pi sticky observations

Measured from screens under `parity/evidence/mode-sticky/pi/`.

1. Ready. No crown (`screen-00-ready.txt`).
2. Typed `/poteto-mode sticky` plus the three-word task (`screen-01-typed.txt`).
3. After submit. Crown `Poteto Mode` on, skill block attached, `pstack_mode enabled=true` (`screen-02-after-sticky-submit.txt`, `screen-03-after-first-turn.txt`). Reply `sticky mode on`.
4. Follow-up. Ordinary message `Reply with exactly the digit 7.` without re-invoking sticky. Reply `7`. Crown still on (`screen-05-after-second-turn.txt`).

Sticky holds across the follow-up turn. Measured, not inferred from unit tests.

## Cursor limitation

Tried three sequences after `/poteto-mode` selected in the slash menu.

| Sequence | Hex | Result |
| --- | --- | --- |
| esc-cr (docs Option+Enter for newlines) | `1b0d` | Menu stayed on `/poteto-mode`. No Custom Mode chrome. |
| esc-lf | `1b0a` | Same. |
| CSI `27;3;13~` | `1b5b32373b333b31337e` | Same. |

Screens. `screen-02-option-enter-*-*.txt`, `screen-03-harness-limitation.txt`.

`parity/research/cursor-host/cli/retrieved/reference_terminal-setup.md` documents `\x1b\r` as Option+Enter for newlines after `/setup-terminal`, not as a guaranteed Custom Mode selector for the agent PTY. This harness cannot select Custom Mode from the slash menu. Do not treat Cursor sticky as verified.

## Commands run

```
node parity/scripts/capture-mode-sticky.mjs --pi-only
node parity/scripts/capture-mode-sticky.mjs --cursor-only
```

Re-read Pi screens for crown and replies. Re-read Cursor screens for absence of Custom Mode / Use as Mode.

## Artifacts

- Lever. `parity/scripts/capture-mode-sticky.mjs`
- Evidence. `parity/evidence/mode-sticky/`
- Decision log. `parity/evidence/mode-sticky/.audit/decisions.tsv`
- Report. this file

## Forbidden paths

Did not edit `parity/mismatches.json`, `parity/requirements.json`, or `parity/progress.md`. Did not commit.

## Suggested coordinator follow-ups

1. Keep `PSTACK-MODE-STICKY-001` open on the Cursor side until a host path that can select Custom Mode is measured (interactive terminal, Use as Mode UI, or a documented CLI byte sequence that actually works).
2. Pi sticky binding for the requirement can cite attempt `96494327-…` and the pair JSON.
