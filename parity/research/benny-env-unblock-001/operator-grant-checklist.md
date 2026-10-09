# Operator grant checklist (Benny env unblock)

Captured 2026-10-09T04:24Z. Presence-only. No secret values.

This checklist is for the account owner. Agents must not invent Slack posts, bot tokens, or Automations editor saves.

## Measured state (this machine)

| Path | Presence |
| --- | --- |
| `SLACK_BOT_TOKEN` / `BENNY_SLACK_BOT_TOKEN` env | absent |
| `~/.config/benny/configuration.yaml` | absent |
| Shell/profile exports for SLACK_/BENNY_ | none in `.zshrc` / `.zprofile` / `.zshenv` |
| Repo `.env` / `.envrc` | absent |
| Slack CLI (`slack` v4.7.0) | present; `auth list` shows workspace `acreconnect` |
| `slack doctor` Token status | Valid (app-dev workspace credentials) |
| `slack api auth.test` | `not_authed` |
| Slack desktop app process | running |
| Keychain items named Slack Safe Storage / Slack Key | present (desktop app storage, not Benny bot env) |
| `~/.slack/credentials.json` | present (CLI app-dev; do not paste into evidence) |
| `plugin-slack-slack` MCP namespace | `needsAuth` |
| Slack MCP `mcp_auth` in this agent env | failed (IDE-only interactive auth) |
| Project `mcp-auth.json` Slack entry | absent (only Atlassian key present) |
| One MCP OAuth attempt file marked slack-related | present under Cursor `mcp-oauth-attempts` (incomplete for agent tools) |
| Automations editor in cursor-agent / Pi PTY | unavailable (probe literals + prior pair env-blocked) |

Important. Slack CLI Valid plus desktop app running does **not** satisfy Benny bot wiring or harness-usable `slack api` auth.

## Probe note (hardcoded blockers)

Even after operator grants, these probe fields stay literal `false` until a later unit changes the probes or adds detectors:

- triage. `configuredSlackActionsResolvableInHarness`, `slackMcpInteractiveAuthAvailableInThisAgent`, `liveSlackPostAllowedWithoutOwnerGate`
- thread-safety. `automationsEditorAvailableInPtyHarness`, `slackMcpInteractiveAuthAvailableInThisAgent`, `configuredSlackActionsResolvableInHarness`, `liveSlackSevenCheckPostAllowedWithoutOwnerGate`, `designatedTestChannelConfigured`
- creation-boundary. `automationsEditorUiAvailableInCursorAgentPty`, `automationsEditorUiAvailableInPiPty`

Done predicates below therefore split into (A) operator grants on the host and (B) probe/harness recognition + Cursor+Pi pair capture. Closing a mismatch needs (A)+(B) and a linked pair, or an oracle freeze by the owner.

---

## A. Shared Slack / Benny grants (triage + thread-safety)

### A1. Benny user config (secret-free shape)

Operator action.

1. Create `~/.config/benny/configuration.yaml` from the pack example under the fixture or reference pack.
2. Point Slack action names at real Cursor/Reference Slack tools the harness can call.
3. Keep token values out of the YAML. Use env names only (matches `PSTACK-SETUP-BENNY-NO-SECRET-001` already verified).

Done predicate.

```bash
test -f ~/.config/benny/configuration.yaml && echo CONFIG_PRESENT
# YAML must not contain xoxb-/xoxp- literals (operator-local check; do not commit the file)
```

### A2. Bot token in agent-visible env

Operator action.

1. Export `BENNY_SLACK_BOT_TOKEN` or `SLACK_BOT_TOKEN` into the shell that will run probes and PTY captures.
2. Prefer a bot scoped to a dedicated test channel. Do not paste the value into chat, evidence, or ledgers.

Done predicate.

```bash
# presence only
[ -n "${BENNY_SLACK_BOT_TOKEN:-}${SLACK_BOT_TOKEN:-}" ] && echo TOKEN_ENV_PRESENT
slack api auth.test  # must return ok:true when token env is active
```

### A3. Slack MCP auth in Cursor desktop IDE

Operator action.

1. In Cursor desktop IDE for this repo, complete `plugin-slack-slack` interactive auth.
2. Confirm tools appear (not `needsAuth`).
3. Re-open or re-attach the agent session so MCP tools load.

Done predicate.

- `GetDynamicTools` on `plugin-slack-slack` returns tools with `namespaceStatus` not `needsAuth`.
- Agent-env `mcp_auth` is no longer required for subsequent Slack tool calls.

### A4. Designated test channel + live-post grant

Operator action.

1. Name a dedicated test channel (or harmless-report fixture) for Benny.
2. Explicitly grant account-owner permission for.
   - one triage thread reply (valid-config journey)
   - seven thread-safety check posts and temporary enablement for that test path
3. Do not grant unrestricted customer-channel traffic.

Done predicate.

- Written grant recorded by coordinator (channel id / name, scope, expiry).
- Standing prefs 5/6 satisfied for that narrow scope only.

### A5. Harness-resolvable Slack read/post actions

Operator action.

1. Wire the action names in `configuration.yaml` to tools both Cursor and Pi journeys can invoke.
2. Confirm a dry read of the test thread works before any write grant is used.

Done predicate.

- A capture worker can read the designated thread without fabricating adapters.
- Probe field `configuredSlackActionsResolvableInHarness` can be flipped by detector or temporary probe update after proof.

---

## B. Per-mismatch close path

### BENNY-TRIAGE-VALID-CONFIG-ENV

Depends on A1–A5 (A4 limited to one thread reply).

Recapture commands (after grants; do not run until grants clear).

```bash
cd /Users/josh-desktop/src/personal/pi-pstack-parity-again
node parity/scripts/probe-benny-triage-valid-env.mjs
# expect exit 0 and runnable:true only if probe detectors see grants
# then run the valid-config Cursor+Pi journey playbook (not invented here)
# write pair under parity/evidence/benny-triage/ with attempt IDs
```

Done predicate for coordinator close.

- `parity/evidence/benny-triage/valid-env-probe.json` has `runnable: true`
- Linked Cursor+Pi pair for valid-config thread-only verdict
- No fabricated posts; one real granted reply

Merge recommendation until then. **keep-open**

### SETUP-BENNY-THREAD-SAFETY-ENV

Depends on A1–A5 plus Automations editor save witness (B-shared with creation-boundary).

Extra operator action.

1. Complete setup-benny through Automations editor save on a host that can open the editor (Desktop Agents Window / cursor.com/automations / local `/automate` UI).
2. Witness the save out of band if PTY cannot. Do not claim a PTY editor save.

Recapture commands.

```bash
cd /Users/josh-desktop/src/personal/pi-pstack-parity-again
node parity/scripts/probe-setup-benny-thread-safety-env.mjs
# then seven-check journey after real editor save + grant
```

Done predicate for coordinator close.

- `parity/evidence/setup-benny/thread-safety/env-probe.json` has `runnable: true`
- Evidence of editor save (not PTY-invented)
- All seven live checks measured on the designated test channel
- Linked Cursor+Pi pair

Merge recommendation until then. **keep-open**

### SETUP-BENNY-CREATION-BOUNDARY-ENV

Slack tokens alone do **not** unblock this mismatch. Prior pair already env-blocked both hosts (`d6992fb0…` / `cd378e36…`).

Operator action.

1. Provide a host path that can finish first-time create only through built-in `/automate` → reviewed Automations editor handoff.
2. Candidates. Cursor Desktop Agents Window, cursor.com/automations, or a future cursor-agent surface that exposes the editor.
3. Pi currently has `automate-me` only, not built-in `skills/automate` editor handoff.

Recapture commands.

```bash
cd /Users/josh-desktop/src/personal/pi-pstack-parity-again
node parity/scripts/probe-setup-benny-creation-boundary-host.mjs
node parity/scripts/capture-setup-benny-creation-boundary.mjs
```

Done predicate for coordinator close.

- Host probe `runnable: true` (requires real editor availability, not literals)
- New Cursor+Pi pair with editor handoff witnessed, no deep-link / direct backend, no enable before thread-safety

Merge recommendation until then. **keep-open**

---

## Recapture order (after grants)

1. Creation-boundary host path (editor available).
2. Thread-safety after witnessed editor save.
3. Triage valid-config one-reply.

Do not reverse 1→2. Skill contract requires thread-safety before normal enablement.
