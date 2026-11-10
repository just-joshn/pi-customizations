# Open items. Closable vs host-limit

Source: mechanism inventory from explore agent `edd494e1-b9bd-4942-91ec-f8628e0461f9`, cross-checked against `parity/status-2026-11-07.md` and `docs/parity-status.md`.

## Closable (Phase C queue)

| ID | Gap | Likely fix | Verify |
| --- | --- | --- | --- |
| C1 | Prompt names host paths cloud `read` cannot open (personal skills, model rule file, Pi docs) | Prefer redesign: cloud host section must not name unmounted paths; keep injected `pstack_models` and host-loaded skills. Mount RO only if a skill truly must `read` the file. | Unit test on host-section text for cloud + e2e that named paths resolve or are not named |
| C2 | `bash` timeout unit (seconds vs Cursor ms) | Accept ms when value looks like ms, or document + reject ms-shaped values; keep Pi seconds as default | Failing test for `timeout: 30000` meaning 30s wait shape |
| C3 | Shell functions and bg-job cwd do not persist | Replay `declare -f`; apply bg job cwd to session | shell-state unit + e2e |
| C4 | Failed fork/launch leaves machine up | `releaseMachine` on createMachine failure after boot | machine-release test |
| C5 | Worktree cleanup pin set via `/resume` | Protected-worktree store or explicit confirm list | playbook + small store test |
| C6 | `/poteto-help` public links for rewritten files point at Cursor blob | Route rewritten paths to pi-customizations tree | corpus PROMPT-HELP + unit on link picker |
| C7 | GitHub PR watch 7-day default | Default expiry none / 0 like timers | subscriptions test |
| C8 | Node engine allows 22.19; macOS readonly fetch needs 22.21 | `engines.node: >=22.21.0` | package.json + note |
| C9 | Supervisor not a user service | Document + exercise packaging unit scripts | packaging dry-run |
| C10 | Live proofs (image, Slack, Benny, corpus 20–27) | Runs when credentials/usage exist | evidence dirs |

## Host-limit (document + lock equivalent)

Laptop sleep pauses cloud Pi process. Host MCP in cloud. Slack poll. Loopback webhooks. No in-app browser/Canvas. No Debug/Ask modes. Mode skill via section not durable blocks. Media via read/open. No parent usage rollup. Fork needs idle source. s390x readonly network fail-closed. Sandbox stronger than Cursor instructions. team-kit alwaysApply rules unwired (matches CLI). No Bugbot product. No Claude Code harness.

## Not closable as "mount everything"

Cursor cloud VMs do not get the laptop's personal skill tree. Mounting `$HOME` paths into the container would exceed Cursor isolation. C1 defaults to prompt accuracy, not broader mounts.

## Content drift from skill explorer (f765528a)

| Item | Disposition |
| --- | --- |
| setup-benny editor-save gate | Fixed: `/automations` handoff |
| poteto-help install / skill-load | Kept: Pi-true help, not Cursor clone |
| ketchup visualize bar/line | Kept: matches Pi tool |
| make-bot-ui webhook/HTTP 200 | Host equivalent; leave unless live Benny fails |
| pr-review-canvas system browser | Host translation |
| worktree-cleanup `/resume` as pins | In flight |
| Claude Code paragraph | Intentional MISSING_PI |

## Status as of continue

| ID | Status |
| --- | --- |
| C1 | done |
| C2 | done |
| C3 | done |
| C4 | done |
| C5 | done |
| C6 | done |
| C7 | done |
| C8 | done |
| C9 | done |
| C10 | blocked on credentials / Cursor usage |
| worktree-cleanup | done |
| Phase E | suite green (`npm test` 969 passed, `tsc --noEmit`); PR for `0.15.36-pi.35` |
