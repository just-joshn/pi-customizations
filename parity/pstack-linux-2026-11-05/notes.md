# pstack parity run on Linux (2026-11-05 PST / 2026-11-06 UTC)

Goal: pi-pstack reproduces every behavior Cursor pstack 0.15.36 delivers, with what it gets from cursor-team-kit 1.2.0 and the Cursor host, through Pi-native mechanisms, with evidence. Operator order for this run: no subagents, no other LLM sessions doing the work. Running the reference product (Cursor CLI with pstack) as the object under observation is allowed; the operator installed pstack into Cursor CLI for that purpose.

This file is the resume point. `decisions.tsv` is the trail. `ledger.md` is the behavior specification and parity ledger.

## Reference pins (frozen 2026-11-06T07:50Z)

- cursor/plugins checkout `~/Documents/GitHub/plugins` at `bb68f2365eceafa0cb2d253112f675acf5f144cc`. Upstream HEAD `2776ddd2355d6d6c8747d3964600f28daf62f049` is 2 commits ahead and changes nothing under `pstack/`, `cursor-team-kit/`, or `pr-review-canvas/` (`gh api repos/cursor/plugins/compare/bb68f23...2776ddd`: 8 files, none in those paths).
- pstack 0.15.36 (last change `c742dd61`). Installed for Cursor CLI at `~/.cursor/plugins/local/pstack` (23:43 local); `diff -rq` against the checkout exits 0. The desktop cache copy `~/.cursor/plugins/cache/cursor-public/pstack/ae5650fe...` is also identical.
- cursor-team-kit 1.2.0 (last change `2b8ae2ee`). Not installed in Cursor on this host; the checkout is the reference.
- Cursor CLI `2026.11.05-86047df` (installed 23:40, `index.js` sha256 `e31b14ba...`). `2026.10.22-27dcf5f` stays on disk for diffs.
- Cursor CLI config: model Auto, `approvalMode: unrestricted`, `sandbox.mode: disabled`, `networkAccess: user_config_with_defaults`.
- Cursor desktop 3.27.22 (`b1aa50cb`) under `/usr/share/cursor/resources/app`.
- Cursor built-in skills `~/.cursor/skills-cursor/`, synced 2026-11-06T07:44:40Z; snapshot and sha256 list in `.audit/pstack-linux-2026-11-05/skills-cursor*`.
- Pi 1.5.0 (`~/.pi/agent/install/releases/1.5.0`), Node 24.22.2, Bun 1.4.4.
- Host: Ubuntu 26.04.1, kernel 7.0.0-42, x86_64, `kernel.apparmor_restrict_unprivileged_userns=1`, bwrap present.
- Target start: `f4d54d49` (pi-pstack 0.15.36-pi.19). Baseline: `bun run test` 820 passed, 7 skipped (cloud-machine x5 need Docker, video needs ffmpeg, one macOS-only).

## Environment blockers

- Docker daemon is active but `josh` is not in the `docker` group and sudo needs a password. The container cloud machine (G1 container driver) cannot run here. Smallest unblock: `sudo usermod -aG docker josh`, then this run can use `sg docker -c ...`.
- ffmpeg is not installed. The video attachment test (G8) is skipped. A static ffmpeg can be fetched for verification only.

## Prior trail used as leads, not authority

`parity/pstack-complete-2026-11-05/notes.md` (macOS run, same pins plus CLI 2026.11.05) and `extensions/pi-pstack/docs/parity-status.md`.

## Findings this run

- F1 (G13b corrected). Cursor does not keep a finished subagent's background shell running. Evidence: `.audit/pstack-native-parity-2026-11-04/cursor/subagent-bg-shell.jsonl` (CLI 2026.10.22): Task started +0 s, subagent returned +4.0 s, parent received `<task> kind: shell status: aborted task_id title tool_call_id` at +6.8 s, the job never printed its marker. Source: the shell manager (`Fr`/`Hue` in 10.22/11.05 `index.js`) `dispose()` disposes every running shell; each shell's `onComplete` enqueues a `kind: shell` completion whose status is `aborted` when killed. The completion text is rendered server-side (the CLI bundle has no "The following task has finished" string). pi-pstack stops the jobs silently. Real difference: the parent's `aborted` notification. Needs a 2026.11.05 live observation.
- F2. `pi mcp list` exists in Pi 1.5.0. Readonly children launch with `--no-mcp` (`src/task/runner.ts`), matching why/SKILL.md's "readonly strips MCP".
- F3. CLI 10.22 to 11.05 protobuf diff: `ToolCall` oneof unchanged; new messages are hosted Projects, canvases, automations, billing. `ShellArgs` gains `smart_mode_classifier_allowed`. `.audit/pstack-linux-2026-11-05/cli-diff.txt`.

## Open leads

- FORK-RUNNING: upstream orchestrate.md says fork for a worker's checkout, uncommitted changes, "or a running process"; the port refuses a running source and rewrote the sentence.
- RULE-TIMING: upstream says the model rule applies to new chats; the port applies it from the next request. Also check whether CLI 11.05 loads `~/.cursor/rules/*.mdc` and plugin rules at all.
- TOOLS-11.05: capture the model-facing tool list and schemas of a CLI 11.05 session with pstack installed.
- F4 (live, CLI 11.05). A child's background job that finishes while the child still runs never notifies the child. `.audit/.../cursor/subagent-bg-shell-done.jsonl`: child launched `sleep 2; echo` with block_until_ms 0, then waited 8 s in the foreground, and reported no notification; the parent got `kind: shell status: success task_id title tool_call_id` 3.5 s after the Task returned.
- F5 (live, CLI 11.05). A child's background subagent keeps running after the child returns. `subagent-bg-task.jsonl`: child returned at +5.0 s, the grandchild's `kind: subagent status: success ... detail: GRANDCHILD-DONE` reached the parent at +28.8 s.
- F6 (source, CLI 11.05 `1212.index.js`). Subagent executors are built with `wakeupOwnerConversationId: cr.parentAgentId`, where `cr = {chatsDir, parentAgentId, workspacePath}` is process-level and `parentAgentId` is the top-level chat (reassigned only on a chat switch). Every subagent's background work, at any depth, wakes the root chat. The shell executor wraps the registry so each completion is enqueued for that owner; `AwaitShell` suppresses the owner's notice (`markAwaitedCompletion`).
- F7 (live, CLI 11.05). Tool surface in default agent mode: direct Shell, Glob, Grep, Read, StrReplace, Write, SendToCall, AskQuestion, GetDynamicTools, CallDynamicTool; dynamic `cursor` namespace AwaitShell, CreateGoal, Delete, EditNotebook, FetchMcpResource, GenerateImage, SwitchMode, Task, TodoWrite, UpdateGoal, WebFetch, WebSearch; plus installed MCP plugins. Task schema byte-identical to CLI 10.22 (no fork, readonly, environment, cloud_base_branch). pstack and team-kit never reference WebSearch, WebFetch, goals, SendToCall, EditNotebook, or FetchMcpResource (`git grep`), so those are general host tools outside pstack's contract.
- F8 (source). `fork_turns`/`fork_from` exist only on desktop's hosted `agent.v1.CreateAgentArgs`. Fork semantics, including a running source, are decided server-side: opaque here.
- F9 (source, CLI 11.05 `LocalCursorRulesService`). Rules load once per session from the workspace and every ancestor directory (`<dir>/.cursor/rules/*.mdc`, `AGENTS.md`), plus nested discovery; the watcher covers only the workspace root's own rule globs. `~/.cursor/rules/pstack-models.mdc` therefore applies only to workspaces under `~`, and only to sessions started after it is written.

## Resume point 2026-11-06 (after a Pi restart)

State on resume: no source change yet; ledger.md, decisions.tsv, probe-cursor.sh, and the .audit probes intact; temporary team-kit install and probe rule removed. Units in order: U1 BG-OWN, U2 RULES-PLUGIN, U3 RULE-SCOPE/TIMING, U4 CREATE-SKILL, U5 SHELL decision.

## U1 design: background work belongs to the root chat

Data shape (`src/inbox.ts`): `InboxItem = { type: 'shell'; from; notice: ShellNotice } | { type: 'adopt'; from; agentId }`, one JSON file per item under `<workspace state>/inbox/<root session id>/`, written by rename so a reader never sees half a file, consumed in name order and deleted by the root.

Root identity travels down the tree as `PI_PSTACK_ROOT_SESSION` and `PI_PSTACK_ROOT_PID`, set from the main chat and inherited unchanged, as Cursor builds every subagent executor with the top-level chat as wakeup owner.

- A subagent (depth >= 1) never delivers its own shell notices; it posts them to the root inbox (BG-OWN-1, BG-OWN-2). An observed job posts nothing (BG-OWN-6).
- At its shutdown a subagent aborts its running jobs and posts an aborted notice for each (BG-OWN-3). The launch text loses the Pi-only subagent note (BG-OWN-5).
- A subagent's background Task (not cloud) starts as a detached local run watched against the root pid, recorded with the root session as owner, and announced with an `adopt` item; the root follows it and delivers its `kind: subagent` notice (BG-OWN-4). The root kills it at shutdown, as Cursor's in-process registry dies with the CLI.
- The root clears its inbox at session start (items addressed to an earlier process), watches it while the session is active, drains it at every one-shot settle, and holds a shell item from an agent it still tracks until that agent's own result is out, so the order matches Cursor (subagent result, then its job notices).

Accepted divergence: Cursor delivers nothing after the CLI exits; Pi drops the same items by clearing the inbox at the next session start.

## State at 2026-11-06T16:20Z

Units done: U1 BG-OWN (plus BG-OWN-7: a cloud agent is the top of its own tree), U2 RULES-PLUGIN, U3 RULE-SCOPE and RULE-TIMING, U4 CREATE-SKILL, LINUX-OWNER (container machine runs as the host user on Linux), TEST-SUPERVISOR, RES-007 fences. U5 SHELL-WINDOW and SHELL-STATE: open by decision (see ledger).

Receipts:
- `make verify` exit 0 at 08:50Z (before BG-OWN-7, LINUX-OWNER, and the test fixes): pi-pstack 832 passed, 7 skipped; maintainer 1949; rea 1510 (+1 skipped); anthropic-oauth 393; antigravity 349; xai 131. `/tmp/make-verify-linux-4.txt` (not kept in the repo).
- Container tests on Linux: `sg docker -c 'vitest run test/e2e/cloud-machine.e2e.test.ts'` 5 passed after the LINUX-OWNER fix (the first run failed cleanup on root-owned files).
- Video test: 1 passed with the flatpak runtime's ffmpeg 7.1.3 (`/tmp/flatpak-ffmpeg-bin` wrappers).
- Live differential (real Pi, deepseek-flash, this tree loaded alone): `live/subagent-bg-shell*.jsonl`, `live/subagent-bg-task.jsonl`, all three matching the Cursor 11.05 probes.
- Mutations (all caught, receipts in `.audit/pstack-linux-2026-11-05/mutations/`): child-hears-own-jobs, shutdown-silent, no-adoption, adopted-outlives-root, cloud-agent-not-own-root, machine-runs-as-root, no-hold, no-suppression, rules-injected, rule-every-request, rule-everywhere, create-skill-redesigned, broken-link-outside-fence.

Next: final full suite under Docker and ffmpeg, final make verify, commit on a feature branch (no push: publication needs the operator), final fact-check of every claim in CHANGELOG, parity-status, and ledger.
