# pi-pstack-two round 2 review: parity coverage

## Confirmed defects

**1. `/name` attaches only pstack's own skills, but pstack tells users to type `/name` for skills it creates (medium).**
- **Where:** `src/aliases.ts:23` keeps an alias only when the skill's real path is under the package `skills/` folder. `src/sections.ts:32` tells the model that `"/X"` means `<SKILLS>/X/SKILL.md`, and `<SKILLS>` is the package folder.
- **Upstream:** In Cursor, `/name` works for any skill. `automate-me/SKILL.md:71` builds a personal `-mode` skill and tells the user to invoke it as `/<handle>-mode`.
- **Probe:** I added `<agentDir>/skills/jay-mode/SKILL.md` to a temp sandbox.
  - `/jay-mode hello` reached the model as literal text, and the scripted model replied `ECHO: /jay-mode hello`.
  - `/skill:jay-mode hello` expanded normally.
  - The host map then points the model at `<package>/skills/jay-mode/SKILL.md`, which does not exist.
- **Why the record misses it:** CMD-001 covers only "any shipped skill", and decision D2 narrows aliases to package skills without noting the skills pstack itself generates. `/mode` accepts any loaded skill (`src/mode.ts:59-65`); the alias path does not.

**2. In an agent-paced loop, a `Loop {wake_in}` call made while a wake is already scheduled is silently dropped (medium-low).**
- **Where:**
  - `src/loop.ts:104-108`: `wake` stores `nextWakeMs` but leaves the existing timer in place.
  - `src/loop.ts:86`: `settled` returns early when a timer exists.
  - `src/loop.ts:79`: `fire` deletes `nextWakeMs`.
  - `src/loop.ts:155`: the tool still replies "Next loop run in …".
- **Probe (RPC, scripted model):** I armed `Loop {prompt, wake_in:"20s"}`. Three seconds later, a user turn called `Loop {wake_in:"2s"}`. The tool returned `Next loop run in 2s, after this turn ends.`, but no loop run arrived in the next 9 s.
- **Why it matters:** This is the case the playbooks describe. `babysit.md:18` says "Answer a user question mid-loop and continue", and `autonomous-run.md:6` pairs a watcher subagent with a long heartbeat.
- **Untested:** `test/loop.test.ts` never reschedules a wake while a timer is pending. It also never exercises `Loop {stop:true}` or the refusal when the tool is forced active, although HOST-004 claims both.

**3. The `model` parameter accepts reasoning levels Cursor would reject, and reports the level it asked for, not the one that ran (low).**
- **Where:** `src/task/models.ts:60-67` and `:49-57` map any effort word onto any model, including non-reasoning ones. `test/task-model.test.ts:34` expects `thinking: 'high'` for a model declared `reasoning: false`.
- **Why it matters:** Pi silently clamps unsupported levels (`agent-session.js:2053-2054`). Cursor only accepts listed slugs (F1 `model`: "must resolve to one of the available model slugs").
  - `setup-pstack` step 3(b) depends on that rejection ("Grok slugs top out at `xhigh`"). In the port, `grok-4.7-max-fast` would validate and run at a lower level.
  - The Task details still record the requested level (`tool.ts:134`).
- **Spec:** TASK-007 does not mention levels a model does not support.

**4. The host map tells one-shot runs to use `AskQuestion`, which those runs don't have (low).**
- **Where:** `src/sections.ts:37` names AskQuestion unconditionally. But `src/ask.ts:68-70` removes the tool without a UI, so the guidance message at `ask.ts:82` cannot be reached.
- **Effect:** In print and JSON runs, including every subagent, a model following setup-pstack or automate-me ("Prefer AskQuestion") gets "Tool AskQuestion not found", not the prose guidance HOST-005 promises.
- **Contrast:** This is the same kind of problem the `/loop` line had in round 1, which was fixed by making that line depend on the mode (`sections.ts:41`).

**5. Tests that check less than their ledger row claims (low).**
- `test/resources.test.ts:151` (RES-007) checks only links starting with `./` or `../`, and skips the 8 links of the form `references/x.md`. None of those 8 is broken today.
- TASK-014 claims usage "counts toward session totals". `task.e2e.test.ts:45` only checks `result.usage.totalTokens > 100`; nothing reads the session stats.
- TASK-015's background `status: error` notice has no test; only the foreground failure is covered.
- `mode.e2e.test.ts:39-48` never checks that the first turn (the `/mode … task` turn itself) carries `<pstack_mode>`.

## Suspicions and questions

- **TASK-017's NOT VERIFIED reason may be too strong.** `ToolResultEventResult.usage` (`core/extensions/types.d.ts:1090-1095`) lets a `tool_result` handler set usage on any later tool result. That is a public, if indirect, way to bring background usage into the totals. The ledger gap doesn't consider it.
- **The cloud refusal leaves the playbooks with no isolation substitute.**
  - `swarm/SKILL.md:30`, `orchestrate.md:17` and the autopilot playbooks default to `environment:"cloud"`, so every first spawn fails in the port.
  - The refusal text (`tool.ts:42`) says to "give each worker that writes its own git worktree", but Task has no working-directory parameter. Children always run in the parent's directory (`tool.ts:83`).
  - The host map's "offer the local alternative" can stall autonomous runs, which `autonomous-run.md:4` forbids ("Do not park reversible work for the human").
  - NA-001 describes the hosted VM accurately, but the isolated checkouts these playbooks rely on get no mapping and no test.
- **`readonly: true` removes all shell access, but the spec's own evidence for TASK-008 allows read-only commands.** That evidence (S3) says "no state-changing shell commands". `how` explorers and `interrogate` reviewers, which run readonly, cannot run `git log` or `git blame`. This divergence is not recorded.
- **`paths` (typescript-best-practices) is kept as `cursor-paths` metadata.** The spec never says what Cursor does with it (auto-attach or not). The skill has `disable-model-invocation: true`, so the field is probably inert, but RES-004 doesn't say so.
- **Checking whether a subagent is still alive has no Pi mapping.** `ketchup` says to "say which are still running", and `orchestrate.md:95` says to probe liveness without resuming ("Transcript mtime is not liveness"). The host map doesn't mention the `<id>.lock` file or any other liveness signal.
- **`recall/SKILL.md:15` spells out the path `~/.cursor/projects/<slug>/agent-transcripts/…`.** The host map maps only the bare `agent-transcripts/`. `reflect` matches on `message.content[0].text` in the first JSONL line, and in Pi that line is the session header. Both probably fall back gracefully, but neither is mapped or tested.
- **Symlinked install with children.** A child gets `-e <real path>` while settings name the symlink. In my probe this caused no duplicate-load error, so I am not raising it as a defect.

## Overall assessment

The round-1 recheck findings are fixed, and the fixes are tested:
- Aliases now match symlinked installs.
- `Loop` is removed in print and JSON runs, and the host map's `/loop` line depends on the mode.
- The dead code is gone.
- The run lock follows the child pid, fails closed, and releases only a lock it still owns.
- A fresh agent's record is written only after its child starts.
- `worktree-audit.sh` finds custom session folders the way Pi does.

The suite passes on this tree (23 files, 218 tests). The 0.15.20 resync's host-visible changes are reflected, and the INCONCLUSIVE rows are stated honestly.

The remaining gaps are where pstack's text reaches past what the spec captured:
- `/name` for skills pstack itself generates.
- A loop wake that is reported as scheduled but is dropped.
- Effort slugs that Cursor would reject.
- An AskQuestion hint shown where the tool is absent.

The cloud and isolation gap, and the TASK-017 reason, deserve a second look before those rows are treated as closed. None of this blocks the core workflows: aliases, modes, Task, todos, the model rule and `/loop`. I would fix defects 1 and 2 and add tests for them before calling HOST-004 and CMD-001 VERIFIED.
