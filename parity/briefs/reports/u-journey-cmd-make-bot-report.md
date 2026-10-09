# u-journey-cmd-make-bot report

## Status

**blocker** for `PSTACK-CMD-MAKE-BOT-UI-KEY-SERVER-001`. Cursor CLI lacks webhook routine host APIs (`update_state` / secret-request). Real PTY both sides still captured. Ledgers untouched by this worker. No commit. No secrets in evidence.

## Attempt IDs

| Side | Attempt ID |
| --- | --- |
| cursor | `bb50ed1b-29ac-4961-bb0a-5c2ffd9834b2` |
| pi | `8721faf4-89e1-4bc5-8abd-105870b4923d` |

Pair path. `parity/evidence/make-bot-ui/pair-make-bot-ui-key-server-1.json` (pairedVerdict `env_blocker`, not a verified pass)

Blocker path. `parity/evidence/make-bot-ui/blocker-make-bot-ui-key-server-1.json`

Probe. `parity/evidence/make-bot-ui/host-env-probe.json`

Fixture digest. `sha256:2b6b4668aab2c08758d602531426082a3d4a25d8eeb2104b963cbf35255f6004` (identical; both `ruleUnchanged: true`)

## Key-server boundary?

| Side | Verdict | Evidence |
| --- | --- | --- |
| cursor | **host_blocked** (no key invented) | `STATUS=host-blocked reason=missing update_state/RoutinePrepare`. Settled screen. No generated UI. No key in chat. |
| pi | **incomplete**, artifacts keep key server-side | `RoutinePrepare` for `fixture-bot-ui`. `server.mjs` uses `relayEvent(ROUTINE_DIR, …)`; browser posts only `command`/`note`. Initializer via `routine-secret.mjs` (echo off). No key in tool args. Done recovered as `STATUS=incomplete …`. |

Worker capture playbook. `parity/evidence/make-bot-ui/PLAYBOOK.md` was written before the capture script run.

## Commands run

1. Wrote playbook, fixture README, `probe-make-bot-ui-host.mjs`, `capture-make-bot-ui-key-server.mjs`.
2. Probe → `verdict: blocker` (Cursor CLI webhook routines unavailable; Pi package registers `RoutinePrepare`).
3. Capture self-test green.
4. `node parity/scripts/capture-make-bot-ui-key-server.mjs --cursor-only` (~20s).
5. `node parity/scripts/capture-make-bot-ui-key-server.mjs --pi-only` (~20m).
6. Re-read Cursor settled screen, Pi session tool order, generated `server.mjs`, recovered Pi done line. Manual Pi rescore for scorer false positive.

## Deviations

1. Sequential `--cursor-only` then `--pi-only`, not one `--both` process.
2. Pi wrote `done.txt` via relative `../../fixture-out/pi` (outside the intended make-bot-ui fixture-out). Recovered into owned evidence; removed the accidental `parity/evidence/fixture-out/` litter.
3. Pi settled TUI dump was empty; scoring used session JSONL + fixture snapshot + recovered done line.
4. Automated Pi outcome briefly said `key_leaked` from skill/negation phrasing. Manual rescore is `incomplete` with `keyBoundaryOnArtifacts: true`.
5. Did not edit `mismatches.json`, `requirements.json`, or `progress.md` (those files may already be dirty from other writers; this worker left them alone).
6. Did not commit.
7. Cross-model show-me-your-work Attention review skipped. This worker is a poteto-agent subagent and must not spawn further subagents.

## Honest product gaps

1. Paired create-and-wire with key-server-ok on both hosts remains unpaid while Cursor CLI lacks Automations webhook routines.
2. Pi path reached draft + server wiring only. Operator key init, `RoutineEnable`, and harmless probe were not completed in this unattended PTY.
3. Acceptance text for host-precondition failures remains DRAFT.
4. Tailscale exposure not exercised.

## Suggested follow-ups for the coordinator

1. Keep `PSTACK-CMD-MAKE-BOT-UI-KEY-SERVER-001` unverified. Merge blocker + pair under family-11 when ready.
2. Unblock with a Cursor host that can run `update_state` webhook create + secret-request, then recapture both sides.
3. Optionally tighten the capture scorer to ignore skill-body and negated "do not paste the sender key" lines before scoring `keyInChat`.
