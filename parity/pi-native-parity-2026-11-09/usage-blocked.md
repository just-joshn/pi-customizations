# USAGE_BLOCKED receipts (C10 and corpus)

These items are not closable without operator credentials or Cursor account usage. Each row names the unlock and the artifact that would flip it from blocked to verified.

| ID | Gap | Block | Unlock | Receipt that would close it |
| --- | --- | --- | --- | --- |
| C10a | Corpus pairs 20 to 27 (how, shell state, default background, natural-language route) | Cursor account "out of usage" at pair 20 on 2026-11-07 | Cursor usage quota for `gpt-5.6-sol-medium` (or the same named model as Pi) | Re-run command in `parity/corpus-2026-11-07/report.md`; both hosts pass mandatory checks; update `runs/score.json` |
| C10b | Extended corpus (swarm, arena, architect, interrogate, setup-pstack, automations, Babysit, Shipping) | Same usage limit plus scenarios not yet authored | Quota plus new scenario files in the corpus builder | New pair directories under `parity/corpus-*/runs/` with score tables |
| C10c | Live Slack subscription fire | No live Slack workspace token in this run | `BENNY_SLACK_BOT_TOKEN` or connector secret plus a test channel | `evidence/slack-live-<date>/` with trigger payload and supervisor log |
| C10d | Live webhook ingress from a remote sender | Loopback-only routines (host limit) plus no external forwarder | Operator-provided tunnel or remote sender hitting the routine URL | `evidence/webhook-live-<date>/` with POST and detached run outcome |
| C10e | Live Benny end-to-end | Depends on C10c | Slack plus committed Benny config | `evidence/benny-live-<date>/` |
| C10f | GenerateImage | No image model configured in the Pi profile used for parity | An image-capable model in `pi` auth/models | `evidence/generate-image-<date>/` with tool result and file |
| C10g | Real reboot survival of the supervisor unit | Packaging dry-run only | Operator reboot after `install-supervisor-unit.sh` | `evidence/supervisor-reboot-<date>/` with unit active and a post-reboot fire |

Sticky-mode cross-process persistence remains a Pi session-lifecycle host issue. The in-process probe already passes. That is recorded under Host limits, not as a closable defect.

Last checked against package `0.15.36-pi.35` and corpus report `parity/corpus-2026-11-07/report.md`.
