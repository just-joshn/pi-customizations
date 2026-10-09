# u-benny-env-unblock-001 report

throughput checkpoint: n/a, read-only investigation

## Status

All three Benny env probes re-ran. All `runnable: false` (exit 2). No closing pairs. No fabricated Slack posts or Automations editor saves. Ledgers not edited. No secrets in this report or in research inventory files.

## Runnable flags (measured)

| Mismatch | Probe | Runnable | Exit |
| --- | --- | --- | --- |
| BENNY-TRIAGE-VALID-CONFIG-ENV | `parity/scripts/probe-benny-triage-valid-env.mjs` | **false** | 2 |
| SETUP-BENNY-THREAD-SAFETY-ENV | `parity/scripts/probe-setup-benny-thread-safety-env.mjs` | **false** | 2 |
| SETUP-BENNY-CREATION-BOUNDARY-ENV | `parity/scripts/probe-setup-benny-creation-boundary-host.mjs` | **false** | 2 |

Canonical probe outputs on disk.

- `parity/evidence/benny-triage/valid-env-probe.json`
- `parity/evidence/setup-benny/thread-safety/env-probe.json`
- `parity/evidence/setup-benny/creation-boundary/host-env-probe.json`

Research copies.

- `parity/research/benny-env-unblock-001/probes/`

## Overview

This unit asked whether any real credential or config path on the host could make the three Benny env probes runnable without fabricating Slack or editor saves. The answer is no. Slack desktop and Slack CLI app-dev auth are present. Benny bot config, bot token env, Slack MCP agent auth, harness-resolvable Slack actions, designated test channel, owner live-post grant, and Automations editor PTY availability are not.

## Key concepts

- Slack CLI workspace Valid is not Benny bot auth. `slack doctor` reports Valid while `slack api auth.test` returns `not_authed`.
- Slack MCP interactive auth is IDE-only. Agent `mcp_auth` fails with that exact message. Namespace status is `needsAuth`.
- Creation-boundary is an editor-host problem, not a token problem. Prior Cursor+Pi pair already env-blocked both sides.
- Several probe blockers are literal `false` fields documenting harness policy. Operator grants alone will not flip `runnable` until detectors or a follow-up unit update those fields after proof.

## How it works (probe gates)

**Triage valid-config.** Needs user Benny config, bot token env, resolvable Slack actions, Slack MCP (or equivalent) in the agent, and an owner gate for one live thread reply. Missing all of those still.

**Thread-safety.** Adds Automations editor save in a witnessable host, `slack api` session, designated test channel, and owner gate for seven-check posts. Still blocked.

**Creation-boundary.** Requires `/automate` → Automations editor handoff inside a host the harness can drive. `cursor-agent --help` still omits `/automate` and Automations editor. Locked cursor-agent bundle has no `automate/SKILL.md`. Pi has `automate-me` only.

## Where things live

| Artifact | Path |
| --- | --- |
| Auth inventory | `parity/research/benny-env-unblock-001/inventory/` |
| Operator grant checklist | `parity/research/benny-env-unblock-001/operator-grant-checklist.md` |
| This report | `parity/briefs/reports/u-benny-env-unblock-001-report.md` |
| Prior triage blocker report | `parity/briefs/reports/u-journey-cmd-benny-triage-valid-report.md` |
| Prior thread-safety blocker report | `parity/briefs/reports/u-journey-setup-benny-thread-safety-report.md` |
| Prior creation-boundary pair | `parity/evidence/setup-benny/pair-setup-benny-creation-boundary-1.json` |

## Candidate auth paths (names / presence only)

| Candidate | Presence | Usable for Benny probes? |
| --- | --- | --- |
| `SLACK_BOT_TOKEN` | absent | no |
| `BENNY_SLACK_BOT_TOKEN` | absent | no |
| Other `SLACK_*` / `BENNY_*` process env | none | no |
| `~/.config/benny/configuration.yaml` | absent | no |
| Shell exports in zsh profiles | none | no |
| Repo `.env` / `.envrc` | absent | no |
| Slack CLI + `~/.slack/credentials.json` | present | no for Benny API (`auth.test` not_authed) |
| Slack desktop app + Keychain "Slack Safe Storage" | present | no (app storage, not bot env) |
| `plugin-slack-slack` MCP | present, `needsAuth` | no in agent env |
| Project `mcp-auth.json` Slack entry | absent | no |
| MCP OAuth attempt with slack-related identifier | one file under Cursor globalStorage | incomplete; tools still unavailable |
| 1Password CLI / direnv Benny path | absent | no |

## Gotchas

1. Do not treat Slack desktop liveness as probe unblock.
2. Do not paste tokens into evidence or reports.
3. Do not claim editor save from PTY.
4. Closing requires linked Cursor+Pi pairs (or owner oracle freeze). Probe `runnable: true` alone is not enough for requirement verified.
5. Prefs 5/6. Live Slack posts need explicit account-owner grant.

## Closing pairs

None. No new journey attempts. No pair JSON written under evidence beyond re-running existing probes.

## Operator grant checklist

Full checklist with done predicates and recapture commands.

`parity/research/benny-env-unblock-001/operator-grant-checklist.md`

Short form.

1. Create secret-free `~/.config/benny/configuration.yaml` with harness-resolvable Slack action names.
2. Export `BENNY_SLACK_BOT_TOKEN` or `SLACK_BOT_TOKEN` into the capture shell. Confirm `slack api auth.test` ok.
3. Complete Slack MCP auth in Cursor desktop IDE until `plugin-slack-slack` is not `needsAuth`.
4. Designate a test channel. Grant one triage reply and seven-check posts only.
5. For creation-boundary and thread-safety, provide an Automations editor host path outside PTY invention.
6. Re-run the three probes. Capture Cursor+Pi pairs only when probes and grants clear.

## Merge recommendations (coordinator)

| Mismatch | Recommendation | Reason |
| --- | --- | --- |
| BENNY-TRIAGE-VALID-CONFIG-ENV | **keep-open** | Probe still blocker. No valid-config pair. Inventory shows no bot config/token path. |
| SETUP-BENNY-THREAD-SAFETY-ENV | **keep-open** | Probe still blocker. No editor save + seven-check pair. Slack CLI Valid ≠ API auth. |
| SETUP-BENNY-CREATION-BOUNDARY-ENV | **keep-open** | Probe still blocker. Prior env-blocked pair unpaid for editor handoff. Tokens would not fix this. |

Do not mark the related requirements verified. Coordinator owns any ledger merge.

## Commands run

1. Presence inventory of env, `~/.config/benny`, Slack CLI, desktop app, shell profiles, MCP config files, keychain name matches.
2. `GetDynamicTools` / `mcp_auth` on `plugin-slack-slack` → IDE-only auth failure; namespace `needsAuth`.
3. `slack doctor` (Valid) and `slack api auth.test` (`not_authed`).
4. Re-ran all three probes. Copied JSON under `parity/research/benny-env-unblock-001/probes/`.
5. Wrote operator checklist and this report.

## Forbidden checks

- Ledgers. not edited
- Fabricated Slack / Automations success. none
- Token values in report or inventory. none (lengths / redacted only)
- Further subagents. none
