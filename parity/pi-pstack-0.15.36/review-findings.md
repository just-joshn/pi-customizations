# pi-pstack 0.15.36 review findings (to fix)

Package: `/Users/josh-desktop/src/personal/pi-customizations/extensions/pi-pstack` (written `PKG` below).
Upstream source of truth: `/Users/josh-desktop/src/experiments/plugins/pstack` and `/Users/josh-desktop/src/experiments/plugins/cursor-team-kit/skills/{deslop,control-cli,control-ui}` at commit `c742dd6`.
Design spec: `design.md` and `decisions.tsv` in this folder. Pi 1.4.0 docs: `/Users/josh-desktop/.pi/agent/install/releases/1.4.0/node_modules/@earendil-works/pi-coding-agent/docs/`.

Goal: pi-pstack has 100% behavioral parity with Cursor's pstack plugin (and the three team-kit skills), in a fully Pi-native way, with no dependency on Cursor.

## Decided contracts (all agents rely on these)

- **Steer a running worker.** Children run under Pi RPC mode (`docs/rpc.md`, `rpc-commands.md`) instead of `--mode json`, so the owning process can send `steer`, `follow_up`, and `abort`. `Task resume <id>` on an agent that is running in *this* process delivers the prompt as a steer (Cursor's "message a worker") and returns at once; it no longer errors. On an agent running in another process it still refuses.
- **Stop a worker.** New tool `stop_agent` `{ agent_id }`. It aborts a worker this process owns (RPC `abort`, then the existing kill grace), or signals the lock's live pid for one owned by another process of this user. Reports what happened. Idle/finished agents: no-op with a clear message.
- **Fork from a turn.** Task gains `fork_turns` (positive integer, only with `fork`): copy only the first N user turns of the source (Cursor `agent.v1.CreateAgent.fork_turns`).
- **Isolated workers share the root workspace.** The root chat's workspace state dir passes to children through an env var (like `PI_PSTACK_ROOT_STORE`); `projectsDir`, `subagentDir`, `storeDir`, and artifacts derive from it, so every agent in the tree sees the same Projects, records, and transcripts. `agent_status` in the root sees every descendant.
- **Plan mode never writes.** A Task in plan mode is forced `readonly` *for that launch only* (never written into the agent's record) and `environment: "local"` (no worktree); `fork` in plan mode is allowed (transcript copy is pi-pstack state, not a user file) but readonly.
- **Model ids.** A bare model id offered by several providers resolves to the parent chat's provider when it offers that id, else errors listing the choices. Text keeps bare ids.

## Findings

### Code
- C-H1 `src/subscriptions/index.ts` restore reuses ids; guards use `live.has(id)`. Use object identity everywhere (`live.get(id) === entry`), guard `remove`. Test: slow fake gh, emit `session_tree` mid-poll, one wake + one cadence.
- C-H2 `src/subscriptions/github.ts` `prHeading` puts raw PR title / check names into a tool-enabled wake. Frame as `<github_event>` with tag-safe JSON like `<webhook_event>`, truncate title; `sections.ts` SUBSCRIPTIONS_LINE says GitHub event fields are untrusted data.
- C-H3 plan mode + `environment:"cloud"` creates a worktree/branch (`plan.ts:117`, `task/tool.ts`).
- C-H4 no per-worker stop/steer (see contracts).
- C-M1 plan mode persists `readonly` into a resumed agent's record (`task/tool.ts` resume `writeRecord`), also on failed spawn.
- C-M2 isolated workers get a different projects/subagent/store dir (`paths.ts`, `index.ts:44`, `task/tool.ts` cwd).
- C-M3 `rule.ts` migration races (`wx` write, tolerate EEXIST/ENOENT, never overwrite an existing `.migrated`).
- C-M4 `sections.ts` tells depth-2 and readonly sessions about Task/agent_status they lack; make host/subagents sections capability-aware. Also list every Task param (fork, fork_turns, environment, cloud_base_branch, file_attachments).
- C-M5 bare model id ambiguity (`task/models.ts:56-62`), see contracts.
- C-M6 `src/mode.ts` says "Custom Mode"; say "Mode <skill> is on…", "No mode is on.", "Mode on: <skill>. /mode off exits." Update `test/mode.test.ts`, `test/e2e/mode.e2e.test.ts`; HOST-008 also scans `pstack_mode`, `pstack_plan`, `pstack_loop`.
- C-M7 Task schema says run_in_background defaults to the type setting, but resume runs foreground. Make resume follow the type setting too.
- C-L1 `webhook.ts` chunked oversize body loses 413 (drain or end-then-destroy). Test it.
- C-L2 `ensureCredentials` can rotate a key across processes (`wx`, re-read on EEXIST, never regenerate an existing file unless invalid after retries).
- C-L3 `records.ts` `isRecord` does not validate `createdAt`/`model`; `status.ts` sort throws. Bounded tail read for last assistant text.
- C-L4 `visualize.ts` no series cap, `Math.max(...)` spread; same-second title collision.
- C-L5 `/routines` writes `process.stdout`; use `ctx.ui.notify`.
- C-L6 `agent_status` lacks `readOnlyHint`/`openWorldHint:false` annotations.
- C-L7 GitHub baseline resets on every `session_tree` restore; keep baselines for entries whose id survives the restore.
- C-L8 design deviation records: print/JSON rejects every subscribe tool (keep; record in decisions.tsv).

### Text (all ported Markdown under PKG: skills, agents, docs, automations, README)
- T1 `skills/poteto-help/SKILL.md:42,143` "Only /setup-pstack loads from the user's words" is false. Check which skills lack `disable-model-invocation` (setup-pstack, deslop, control-cli, control-ui) and match upstream intent.
- T2 `automations/benny/skills/setup-benny/SKILL.md:172` vs `:240` contradictory (two sessions vs list both). Each automation's fire should run on its configured model via `Task model`, in both timer and webhook mode, so one owning session suffices.
- T3 `setup-benny:41`, `FOR_AGENTS.md:72` Task "rooted in the target repository" (Task has no cwd): require the setup session itself to run in the target repo.
- T4 benny `reproduce-automation-prompt.md:19-22`, `triage-automation-prompt.md:20-22`: skip only `done` ledger rows; retry stale `claimed` rows.
- T5 benny `configuration.example.yaml` models inert in timer mode (fix per T2).
- T6 `skills/arena/SKILL.md:17` families "by prefix" wrong for provider-qualified specs: "go by the model id after the provider".
- T7 `skills/poteto-mode/SKILL.md:99` "same slug without -fast": phrase per the `-fast` variant wording used elsewhere.
- T8 `skills/setup-pstack/SKILL.md:29` effort token: `:<level>` suffix or `effort=` in `[...]`; `fast=true` is speed.
- T9 "Auto" in `setup-pstack:31`, `poteto-help:44` → the chat model.
- T10 `worktree-cleanup.md:5` "sidebar" → `/resume`.
- T11 "VM" in `autopilot-full.md:12`, `multi-phase-plan.md:123` → worker / lane worktree.
- T12 "agent mode"/"Ask mode" in `why/SKILL.md:13`, `reflect/SKILL.md:25,39`, `poteto-mode/SKILL.md:97` → `readonly` unset / do not set `readonly: true`.
- T13 `docs/guide/01-setup.md:32` "model slug" → "model".
- T14 benny "automation run output" (triage-issue-reports:228, reproduce-and-fix-issues:124,204,297, references/verify-existing-fix.md:88) → the run's final message (its Task notification).
- T15 Steer/stop text (poteto-mode SKILL 97,103; orchestrate.md:22; multi-phase-plan.md:42; autopilot-full.md:22) must name the real mechanisms: `Task resume` on a running worker steers it; `stop_agent` stops it.
- T16 `setup-pstack`, `make-bot-ui:21,35`, `setup-benny:85`, README hardcode `~/.pi/agent`: use the path the system prompt / tool result names (respect `PI_CODING_AGENT_DIR`).
- T17 `multi-phase-plan.md:10,26,36-40,65,152` repo-relative `extensions/pi-pstack/...`: use the package root the system prompt names (`<SKILLS>`); for `git show`, the program repo path, with a stated placeholder.
- T18 `setup-benny:186` `/routines/<name>` → `<slug>` (kebab-case of the name).
- T19 README: `check-plan` is Node-only; `worktree-audit.sh` supports GNU too; statechart usage text; "branches are never pushed" → pi-pstack never pushes them; readonly workers have no MCP/network; `[fast=true]` needs a base model; "installing changes nothing" → tools and system-prompt sections load, skills wait; "checks change" → check concludes or its conclusion changes; one-writer is per lock (stale-lock race noted); print/JSON waits unless aborted; Task resume/fork vs Pi `/resume`/fork wording.
- T20 design.md §2.x: update for bash_readonly, agent_status in plan tools, 405/400, once for cron, 30-day cap, port 0, status extra fields, plus the new contracts above. decisions.tsv: add each decision.
- T21 `test/resources.test.ts` RES-012: add README.md to scanned roots with explicit line allowlist (`.mdc` migration, `cursor-team-kit.LICENSE`), case-insensitive host-path patterns (`cursor.com`, `github.com/cursor/`), line-level instead of whole-file OUTSIDE_DATA exemptions.
- T22 Check every upstream skill's frontmatter and body still maps 1:1 after the above; no new Cursor term.
