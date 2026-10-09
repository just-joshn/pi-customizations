# u-cursor-custom-mode-path report

**status.** exhaustive-negative (cursor-agent PTY). No success attempt ID. Ledgers untouched. No commit.

throughput checkpoint: n/a, read-only investigation

## Verdict

No measured host path enters Custom Mode for `/poteto-mode` in locked cursor-agent `2026.10.01-e373342` under this account's live gate state. All Meta+Enter byte sequences the CLI recognizes leave the slash menu open with no Custom Mode chrome. The slash footer `enter to attach · option+enter to use as mode` never appeared, which matches Statsig gate `glass_custom_modes` being off (default `false` in the binary; remote override not observed).

## Sequences and UI paths tried

### Docs and help (citations)

| Source | Claim |
| --- | --- |
| `parity/research/cursor-host/customization/sources/prompting.md` § Custom Modes | Option+Enter / Alt+Enter, or **Use as Mode** from the skill entry. Available in Agents Window and CLI. |
| `parity/research/cursor-host/cli/retrieved/reference_terminal-setup.md` | `\x1b\r` is Option+Enter for newlines after `/setup-terminal`, not a Custom Mode selector. |
| `extensions/pi-pstack` poteto-help / README | Pi sticky is `/poteto-mode sticky`. Not a Cursor Custom Mode path. |
| `cursor-agent --help` | No Custom Mode / Use as Mode flag. `--mode` only covers plan/ask. |

### Binary Meta+Enter detector (`1322.index.js`)

Sequences recognized as Meta+Enter and probed on a real PTY:

| name | hex | Custom Mode chrome | slash menu stayed |
| --- | --- | --- | --- |
| esc-cr | `1b0d` | no | yes |
| esc-lf | `1b0a` | no | yes |
| csi-13-3 | `1b5b31333b337e` | no | yes |
| csi-13-3-bare | `5b31333b337e` | no | yes |
| csi-27-3-13 | `1b5b32373b333b31337e` | no | yes |
| csi-27-3-13-bare | `5b32373b333b31337e` | no | yes |
| csi-13-3u | `1b5b31333b3375` | no | yes |
| csi-13-3u-bare | `5b31333b3375` | no | yes |

Prior sticky pair `9a6e00d0-b7c7-43c1-b09a-7a2db3209dc7` already failed esc-cr, esc-lf, and csi-27-3-13. This probe adds the remaining detector sequences.

### UI chrome path

- No `Use as Mode` row in the slash menu screens.
- No footer `option+enter to use as mode` on `/poteto-mode` selection.
- That footer is only rendered when `customModesEnabled` is true in `9969.index.js`.

### Statsig override attempt

Attempt `9857dda0-a74d-4546-b69e-1ff3528bdf3e` launched with
`--statsig-overrides '{"featureFlags":{"glass_custom_modes":true}}'`.
Same negative screens. Production build sets `constants.Cu = false`, so
`--statsig-overrides` apply is a no-op (`statsig-overrides.ts` clears when `Cu` is false).

## Attempt IDs

| label | attemptId | customModeReached | modeFooterHint |
| --- | --- | --- | --- |
| baseline-meta-enter | `6977eeec-08bd-4829-810c-11d526d9f9fb` | false | false |
| statsig-override-glass-custom-modes | `9857dda0-a74d-4546-b69e-1ff3528bdf3e` | false | false |

Success attempt ID: none.

## Root cause (measured + binary)

1. `onMetaEnter` sticky handler returns false when `customModesEnabled` is false.
2. `customModesEnabled` is Statsig gate `glass_custom_modes` (default false).
3. Skill run only calls `activateCustomMode` when stickiness is sticky and the gate is on.
4. Live screens lack the mode footer, so the gate is off for this session.

## Verify

Re-read probe screens under
`parity/evidence/mode-sticky/probes/baseline-meta-enter/6977eeec-08bd-4829-810c-11d526d9f9fb/`
and
`parity/evidence/mode-sticky/probes/statsig-override-glass-custom-modes/9857dda0-a74d-4546-b69e-1ff3528bdf3e/`.
`rg` for `Custom Mode|Use as Mode|option+enter to use as mode|Mode active` returned no matches.

## Artifacts

- Lever. `parity/evidence/mode-sticky/probes/probe-custom-mode-path.mjs`
- Summary. `parity/evidence/mode-sticky/probes/probe-custom-mode-path-summary.json`
- Binary notes. `parity/research/cursor-custom-mode-path/binary-findings.md`
- Prior sticky Cursor failure. `parity/evidence/mode-sticky/cursor/9a6e00d0-b7c7-43c1-b09a-7a2db3209dc7`

## How-shaped summary

**Overview.** Cursor sticky Custom Mode is documented as Option+Enter / Use as Mode on a skill slash entry. In this CLI build that path is gated and currently off.

**Key concepts.** Meta+Enter byte detection, `skillInvokeStickiness: "sticky"`, Statsig `glass_custom_modes`, slash footer chrome as the live gate signal.

**How it works.** Slash skill + Meta+Enter calls `onMetaEnter`. If the gate is on, the skill runs with sticky stickiness and activates Custom Mode. If the gate is off, Meta+Enter does not activate mode (menu stays or newline path runs).

**Where things live.** Docs under `parity/research/cursor-host/…`. Runtime in cursor-agent `9969` / `9577` / `1322` index bundles. Pi stand-in is `/poteto-mode sticky` in `extensions/pi-pstack`.

**Gotchas.** Terminal-setup `\x1b\r` is for newlines, not a guarantee of Custom Mode. Hidden Statsig overrides do not work on production (`Cu=false`). Agents Window may still expose Use as Mode when the same gate is on; that is outside this PTY harness.

## Coordinator next actions (report only)

1. Keep `PSTACK-MODE-STICKY-001` Cursor side unverified.
2. Recapture only after `glass_custom_modes` is on for the reference account (footer hint visible), or after a newer cursor-agent changes the gate default.
3. Agents Window interactive capture is a separate host path if CLI remains gated.
