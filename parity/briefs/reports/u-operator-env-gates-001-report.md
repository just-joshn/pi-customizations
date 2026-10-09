# Operator env gates checklist (u-operator-env-gates-001)

How-to for unblocking the six open environment-bound mismatches that keep completion at 92/98. No credentials, Custom Modes toggles, Slack posts, Automations editor saves, or webhook routines were fabricated in this unit. Ledgers were not edited.

throughput checkpoint: n/a, read-only investigation

## Overview

Six mismatches still block verified-pass-paired. Each maps 1:1 to an unpaid requirement. Pi sticky and Cursor Grok-cap halves already have partial evidence. The unpaid half on each gate needs an operator host action, then a recapture. This report is the unblock checklist only. Closing a mismatch stays with the coordinator after fresh pair evidence.

## Key concepts

- Environment-bound means the product path exists in docs or on one host, but this harness cannot exercise the required surface without account-owner wiring.
- `cursor-agent --mode` accepts only `plan` and `ask`. It is not a Custom Mode switch. Measured from `cursor-agent --help` on this host (`choices: "plan", "ask"`). Snapshot at `parity/research/operator-env-gates-001/env-snapshot.json`.
- `/tmp/pi-ref-agent/auth.json` providers present by name only: `claude-subscription`, `deepseek`, `google-antigravity`, `openai`. Provider `xai` is absent. `/tmp/pi-ref-agent/models-store.json` still has an `xai` catalog key listing `grok-4.3`, `grok-4.5`, `grok-4.6`, `grok-4.7`. Detected models require auth, so catalog alone does not unlock Grok writes.

## How it works

For each gate below: re-read the mismatch `nextAction`, confirm the probe or pair still shows the block, do the operator action, run the recapture command or brief, then check the done predicate. Do not mark requirements verified from this checklist alone.

### 1. MODE-STICKY-CURSOR-CUSTOM-MODE-HARNESS → PSTACK-MODE-STICKY-001

**Current probe evidence.** Pair `parity/evidence/mode-sticky/pair-mode-sticky-1.json`. Cursor attempt `9a6e00d0` never reached Custom Mode. Pi attempt `96494327` sticky badge held across turns. Exhaustive-negative path report `parity/briefs/reports/u-cursor-custom-mode-path-report.md` (attempts `6977eeec`, `9857dda0`). Root cause. Statsig `glass_custom_modes` off. `--statsig-overrides` no-op. Meta+Enter sequences leave the slash menu open. `--mode` cannot select Custom Mode.

**Exact operator action.** Enable Custom Modes for this Cursor account/build so the slash footer shows Use as Mode / option+enter to use as mode, or capture sticky on Agents Window / IDE where Use as Mode works. Do not treat `--mode plan|ask` as sticky Custom Mode.

**Recapture.** Brief `parity/briefs/u-mode-sticky-capture.md`. Script `node parity/scripts/capture-mode-sticky.mjs` (Cursor sticky half; keep Pi evidence if still valid). Path probe lever `parity/evidence/mode-sticky/probes/probe-custom-mode-path.mjs`.

**Done predicate.** Linked Cursor+Pi pair shows Cursor Custom Mode sticky across a follow-up turn (Custom Mode chrome present after Option/Alt+Enter or Use as Mode), with Pi sticky still true.

### 2. BENNY-TRIAGE-VALID-CONFIG-ENV → PSTACK-CMD-BENNY-TRIAGE-THREAD-ONLY-001

**Current probe evidence.** Blocker `parity/evidence/benny-triage/blocker-benny-triage-valid-1.json`. Probe `parity/evidence/benny-triage/valid-env-probe.json` (`runnable: false`). Fail-closed half already paired at `parity/evidence/benny-triage/pair-benny-triage-fail-closed-1.json`. Missing. `~/.config/benny/configuration.yaml`, bot token env, harness-resolvable Slack actions, owner grant for one test-thread reply.

**Exact operator action.** Supply valid Benny+Slack wiring with real `source_channel_id` and triage identity. Grant one non-customer test-thread reply (or freeze the oracle to incomplete-config-only). Do not invent Slack stubs as configured actions.

**Recapture.** Brief `parity/briefs/u-journey-cmd-benny-triage-valid.md`. Re-probe with `node parity/scripts/probe-benny-triage-valid-env.mjs` until runnable, then capture the valid-config pair per that brief.

**Done predicate.** Linked Cursor+Pi valid-config pair shows one thread-only triage verdict and no reproduce-or-fix work in the triage skill.

### 3. SETUP-GROK-XHIGH-CAP-PI → PSTACK-SETUP-GROK-XHIGH-CAP-001

**Current probe evidence.** Pair `parity/evidence/setup-grok-xhigh-cap/pair-setup-grok-xhigh-cap-1.json`. Cursor `faeae5d9` pass (10/10 Grok→xhigh under unlimited). Pi `5bafa9a0` fail (`GROK_UNAVAILABLE`, no write). Report `parity/briefs/reports/u-journey-setup-grok-xhigh-cap-pi-report.md`. Auth providers lack `xai` while models-store still lists grok ids under `xai`.

**Exact operator action.** Add xai auth (or another detected Grok-family slug) to the Pi reference agent at `/tmp/pi-ref-agent`. Do not drop Grok rows from the fixture to fake a pass. Do not mark verified on Cursor-only.

**Recapture.** Brief `parity/briefs/u-journey-setup-grok-xhigh-cap-pi.md`. Command `node parity/scripts/capture-setup-grok-xhigh-cap.mjs --pi-only --pi-fixture=mixed` from repo root (or the brief's exact flags).

**Done predicate.** Pi unlimited write keeps every Grok role at xhigh (not max) while Cursor pass remains; linked pair scores pass-paired.

### 4. MAKE-BOT-UI-KEY-SERVER-HOST → PSTACK-CMD-MAKE-BOT-UI-KEY-SERVER-001

**Current probe evidence.** Blocker `parity/evidence/make-bot-ui/blocker-make-bot-ui-key-server-1.json`. Probe `parity/evidence/make-bot-ui/host-env-probe.json`. Pair `parity/evidence/make-bot-ui/pair-make-bot-ui-key-server-1.json`. Cursor `bb50ed1b` host_blocked (no `update_state` / webhook Routines). Pi `8721faf4` incomplete but key boundary held on artifacts. Report `parity/briefs/reports/u-journey-cmd-make-bot-report.md`.

**Exact operator action.** Provide a Cursor host path where `update_state` can create a webhook routine and secret-request delivers the sender key outside chat. Do not invent a sender key or fabricate Cursor webhook support.

**Recapture.** Brief `parity/briefs/u-journey-cmd-make-bot.md`. Probe `node parity/scripts/probe-make-bot-ui-host.mjs`. Capture `node parity/scripts/capture-make-bot-ui-key-server.mjs`.

**Done predicate.** Linked Cursor+Pi pair creates page + webhook wiring with sender key server-only (absent from browser, chat, and skill file).

### 5. SETUP-BENNY-THREAD-SAFETY-ENV → PSTACK-SETUP-BENNY-THREAD-SAFETY-001

**Current probe evidence.** Blocker `parity/evidence/setup-benny/blocker-setup-benny-thread-safety-1.json`. Probe `parity/evidence/setup-benny/thread-safety/env-probe.json` (`runnable: false`). Report `parity/briefs/reports/u-journey-setup-benny-thread-safety-report.md`. Missing Benny config, bot token, Automations editor witness path, harness-usable Slack test channel, owner grant for seven-check posts.

**Exact operator action.** Supply Benny config, a harness-usable non-customer Slack test channel (or harmless report), grant seven-check posts, and provide an Automations editor-save witness path. Do not enable normal Benny traffic until all seven checks pass.

**Recapture.** Brief `parity/briefs/u-journey-setup-benny-thread-safety.md`. Probe `node parity/scripts/probe-setup-benny-thread-safety-env.mjs`, then the capture path that brief names after the env turns runnable.

**Done predicate.** After a witnessed editor save, linked Cursor+Pi evidence shows all seven thread-safety checks pass before normal Benny traffic is enabled.

### 6. SETUP-BENNY-CREATION-BOUNDARY-ENV → PSTACK-SETUP-BENNY-CREATION-BOUNDARY-001

**Current probe evidence.** Blocker `parity/evidence/setup-benny/blocker-setup-benny-creation-boundary-1.json`. Probe `parity/evidence/setup-benny/creation-boundary/host-env-probe.json`. Pair `parity/evidence/setup-benny/pair-setup-benny-creation-boundary-1.json` (Cursor `d6992fb0` / Pi `cd378e36`, both env-blocked). Report `parity/briefs/reports/u-journey-setup-benny-creation-boundary-report.md`. PTY has no `/automate` or Automations editor handoff.

**Exact operator action.** Unblock on a host that can open the Automations editor after `/automate` handoff and complete reviewed editor save. Do not finish creation via backend, draft-field URL, or deep link. Do not enable automations before thread-safety.

**Recapture.** Brief `parity/briefs/u-journey-setup-benny-creation-boundary.md`. Probe `node parity/scripts/probe-setup-benny-creation-boundary-host.mjs`. Capture `node parity/scripts/capture-setup-benny-creation-boundary.mjs`.

**Done predicate.** Linked Cursor+Pi pair finishes first-time Benny triage/repro creation only through Automations editor handoff, with no enablement before thread-safety.

## Where things live

| Kind | Path |
| --- | --- |
| This report | `parity/briefs/reports/u-operator-env-gates-001-report.md` |
| Env snapshot | `parity/research/operator-env-gates-001/env-snapshot.json` |
| Mismatch ledger (read-only here) | `parity/mismatches.json` |
| Standing prefs | `~/.claude/projects/-Users-josh-desktop-src-personal-pi-pstack-parity-again/pstack/orchestrate/pi-pstack-parity/preferences.md` |

## Gotchas

- Do not paste secrets into evidence, reports, or chat. Provider names only.
- `models-store.json` listing grok under `xai` is not the same as auth. Setup still refuses Grok writes without detected `xai/*`.
- Cursor `--mode plan|ask` is unrelated to Custom Mode sticky.
- Fail-closed Benny triage pair does not close the valid-config half.
- Pi Make Bot UI / creation-boundary partials do not close Cursor host-blocked cells.
- Oracle freeze is an owner decision. This checklist does not freeze anything.

## Standing

Did not edit `parity/mismatches.json`, `parity/requirements.json`, or `parity/progress.md`. Did not commit. Did not spawn further subagents. Did not request or paste secrets into this report.
