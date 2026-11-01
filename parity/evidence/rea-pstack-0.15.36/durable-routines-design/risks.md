# Risks. Durable routines supervisor

**User goal.** Durable wakes without inventing silent failure modes (double fires, stolen ports, leaked keys, crossed workspaces, or one-shot mode pretending it can host subscriptions).

## Port conflicts

**Fact today.** `RoutineServer` binds `127.0.0.1` at `PSTACK_ROUTINES_PORT` or 47913. A second listen rejects with `EADDRINUSE` and names the env var.

**Risk.** Interactive restore and the supervisor both call `armWebhook`. Or two supervisors start for the same machine default port across workspaces.

**Mitigations (design).**

- When `supervisor.lock` pid is alive, interactive restore must not start `RoutineServer` for durable webhooks.
- One supervisor process per machine can own the default port and multiplex routes from every workspace registry (slug clash across workspaces becomes a named error). A single-cwd v1 supervisor should document that a second workspace needs `PSTACK_ROUTINES_PORT` or a multi-workspace supervisor mode.
- Supervisor start is idempotent. Second start sees a live lock and exits 0 with "already running" (or joins as a no-op), rather than binding again.

## Double delivery

**Fact today.** One process. Cron uses `lastCronMinute`. Delay cadence derives from `createdAt`. Once removes after fire.

**Risk.** Chat arms in-process while supervisor also arms the same id. Supervisor restarts and re-fires a once timer. Sender retries a webhook POST. Watchdog-style double supervisor without a lock.

**Mitigations (design).**

- Separate writers. Desired state vs `runtime/delivery/<id>.json` claim keys (see `recommended.md`).
- Once timer. Claim then remove from registry; a crash after claim but before remove must treat an existing once claim as done on next reconcile (do not spawn again).
- Interactive + supervisor. Passive list in chat when lock is live. Never two `armTimer` owners for one id.
- Webhook. Same body digest → 200 without second spawn while claim exists. Document that distinct bodies always wake (same as today).

## Credential files

**Fact today.** `<pstack dir>/routines/<slug>/credentials.json`, mode 0600, field `key` (64 hex). Tool results return the path, never the key. `ensureCredentials` is create-if-absent and safe across racing creators.

**Risk.** Supervisor logs the key. A delivery spawn puts the key in argv or env. Registry duplicates the key. Multi-user machine reads `~/.pi`. Packaging examples world-readable copy the credentials directory.

**Mitigations (design).**

- Supervisor reads the key only inside the HTTP handler path already used by `RoutineServer` (file read per request). Never log it. Never put it in the durable registry.
- Headless fire receives the prompt and webhook event block (body is untrusted data, as today's tool text says), not the sender key.
- Keep directory mode 0700 / file 0600. Tests assert modes on write.
- Document that durability does not change the trust boundary. Localhost + file key is still the model; remote exposure still needs the user's own reverse proxy as `make-bot-ui` describes.

## Multi-workspace

**Fact today.** Session subscriptions are per session. Credentials are global under `<pstack dir>/routines/<slug>/` (slug is only from the routine name, not workspace-prefixed). Workspace state for projects/subagents is under `workspaces/<workspaceSlug>/`.

**Risk.** Two workspaces create routine name "Benny" → same slug → same credential file and same URL path. One supervisor watching "all durable dirs" merges routes and the second create clobbers or conflicts. GitHub `gh` runs with the wrong cwd credentials.

**Mitigations (design).**

- Desired state is per `workspaceSlug`. Runtime ledgers too.
- Webhook slug uniqueness stays process-global because the URL space is global on one port. Create must fail across workspaces the same way in-process slug clash fails today (`Routine "…" already uses the slug`). Optionally future-prefix URL with workspace slug; that is a breaking URL change and is **out of v1** unless product asks for it.
- Supervisor spawn sets cwd to `workspaceCwd` from the registry so `gh` and relative paths match the creating chat.
- v1 default. One `--workspace` per supervisor process avoids silent cross-workspace route merges until multi-workspace mode is explicit.

## Print / JSON mode

**Fact today.** `isOneShot` (print, json, or Task child depth > 0) rejects every subscribe tool with a clear error. Restore is a no-op in one-shot. Print/JSON waits for background subagents then exits.

**Risk.** Someone "fixes" durability by allowing subscribe in print mode. A CI JSON run creates a registry entry and exits; the operator thinks a timer is armed with no supervisor. Headless fire incorrectly uses print mode *and* tries to call subscribe tools.

**Mitigations (design).**

- Keep reject-on-create in print/JSON. Durability is "supervisor already running + interactive/RPC create", not "one-shot create".
- Fire runner may be print/RPC for a single prompt execution only. It must not register subscription tools for that run, or must keep `isOneShot` blocking create.
- `list_subscriptions` in a one-shot run can stay read-only against the session branch; optional later enhancement reads the durable registry for status without arming.
- Tests keep asserting subscribe tools throw in print/JSON after the durable work lands.

## Additional risks (short)

| Risk | Note |
|---|---|
| Reboot | Supervisor dies unless optional launchd/systemd install is done. README must not claim reboot survival without that step. |
| Model spend | Detached `spawn` fires bill tokens with no human watching. Same as today's `new_session` while tmux is up; call it out in Limits. |
| Session park drain | If `detachedDelivery: "park"`, interactive must drain inbox on `session_start` or wakes pile up unread. Prefer default `spawn`. |
| GitHub downtime gap | Durability does not replay PR changes while the supervisor was down. Same baseline reset semantics as README. |
| Lock steal race | Two supervisors can still race a dead pid the way agent run locks can (design.md §2.8). Accept and document; delivery claim keys still prevent double spawn after both settle. |

## Acceptance bar for "risks handled"

A follow-up implementation is not done until tests or the verification experiment show all of the following.

1. Chat exit leaves supervisor port and timer arming intact.
2. Second supervisor start does not bind a second port.
3. Once timer produces exactly one marker file after chat death.
4. Duplicate webhook POST with the same body digest does not spawn twice.
5. Print mode still cannot create subscriptions.
6. Credential files never appear in registry JSON or supervisor stdout in the smoke run.
