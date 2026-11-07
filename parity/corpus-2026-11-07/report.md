# pstack corpus, 2026-11-07: Cursor CLI vs pi-pstack on main

## Goal

pi-pstack should behave like Cursor CLI with the pstack plugin when both get byte-identical user prompts. This run measures that with paired live-model attempts against assertions committed before the first attempt.

## Verdict

Parity is **UNVERIFIED** for this corpus.

- 5 of 11 scenarios have a complete Cursor reference. In those 5, both hosts pass every mandatory check in every attempt.
- Cursor ran out of usage on every named model at pair 20 (`runs/20-PROMPT-HOW-READONLY-EXPLORERS-r1/cursor/turn-1.stderr`: "You're out of usage. Switch to Auto"). The 8 Cursor attempts for pairs 20 to 27 are retained as invalid runs. Cross-host comparison for `/how`, shell state, the default background move, and natural-language routing is UNVERIFIED. Only Auto still answered, and Auto is a different model, so it was not used.
- The sticky-mode scenario is UNVERIFIED by design, as pre-registered. Cursor CLI has no headless Custom Mode entry.
- Two pi-pstack defects against the Cursor contract were found. They are in the Defects section.

## Pre-registration

- The corpus is `corpus.json` (SHA-256 `ef9dbe42...`), built by `build-corpus.mjs` from the 2026-11-06 corpus (`prior/corpus.json`, extracted from `stash@{0}`) plus `new-scenarios.json`. The 5 original prompts are byte-identical to the 2026-11-06 file.
- Commit `78c31d92` (2026-11-07T16:19:46Z) holds the corpus, runner, and scorer. It was pushed before the run started at 16:20:49Z. `runs/intent.json` records the corpus and runner hashes the run used, and both match that commit.
- No prompt or assertion changed after results. Assertions that turned out wrong are listed under Assertion findings with their original scores kept.

## Model and controls

| Control | Cursor | Pi | Matched |
| --- | --- | --- | --- |
| Model | `gpt-5.6-sol-medium`, reported "GPT-5.6 Sol 272K Medium" | `openai/gpt-5.6-sol --thinking medium`, reported provider openai, thinking medium, catalog context 272K | Yes |
| Host build | Cursor CLI 2026.11.05-86047df | Pi 1.5.0, Node v24.22.1 | n/a |
| pstack | `--plugin-dir` pstack and cursor-team-kit at 2776ddd2 (pstack 0.15.36) | `npm pack` of main 0bb0d452, pi-pstack 0.15.36-pi.30, archive SHA-256 `f535b0d4...`, installed per attempt with `pi install npm:@justjoshn/pi-pstack@file:<archive>` | n/a |
| Profile | Fresh HOME/XDG per attempt. Only `~/Library/Keychains` is symlinked in for login | Fresh `PI_CODING_AGENT_DIR` per attempt. Only `auth.json` is symlinked in | Yes |
| Approvals | `--trust --force` | No approval gate | Yes |
| Fixture | Separate empty repo per host attempt, identical README bytes, identical commit and tree | Same | Yes |

Controls not matched or not observable:

- Provider routing, build identity, temperature, top-p, seed, and output cap.
- Host system prompts and tool schemas, which differ by design.
- Subagent models. With no model rule, Cursor's `/how` explorers ran on `grok-4.7-high-fast` (pair 20). Pi's isolated profile has no xAI or Anthropic provider, so Pi rejected `grok-4.7[effort=xhigh,fast=true]` and `claude-opus-5-5:xhigh` and fell back to `inherit` (pair 21).
- In a fresh HOME, Cursor also fetched the public marketplace pstack at ae5650fe into `home/.cursor/plugins/cache`, and the sticky-mode attempts read skills from that copy. Its `pstack/` tree is identical to 2776ddd2 (`git diff --stat 2776ddd2 ae5650fe -- pstack` is empty), so skill content did not differ.
- Cursor's stream-json Task events carry no `readonly` field, so `every-task-readonly` is UNVERIFIED on Cursor (pre-registered).
- The attempt PATH has no `pi` or `cursor-agent`. Pi pair 26 ran `pi --list-models` and got "command not found".

## Scenarios

| # | ID | Repeats | What it covers |
| --- | --- | --- | --- |
| 1 | PROMPT-IN-YOUR-OWN-WORDS | 3 | `/in-your-own-words` restates without acting |
| 2 | PROMPT-SHARPEN | 3 | `/sharpen` rewrites a prompt without acting |
| 3 | PROMPT-HELP-NO-WORK | 3 | `/poteto-help` routes to `/how` and links the public source |
| 4 | PROMPT-BRO-FOLLOWUP | 3 | `/bro` restates the previous turn |
| 5 | PROMPT-NONTRIGGER-MENTION | 3 | Naming a skill does not invoke it |
| 6 | PROMPT-POTETO-MODE-ONE-MESSAGE | 2 | `/poteto-mode <task>` opens a playbook and a todo list that starts with its step 1 |
| 7 | PROMPT-MODE-STICKY | 2 | `/mode poteto-mode`, a plain prompt, `/mode off`, a plain prompt |
| 8 | PROMPT-HOW-READONLY-EXPLORERS | 2 | `/how` delegates to readonly generalPurpose Task subagents |
| 9 | PROMPT-SHELL-STATE | 2 | cd and export in one shell call persist into the next |
| 10 | PROMPT-SHELL-DEFAULT-BACKGROUND | 2 | A 40 s command moves to the background at the default wait, then is awaited |
| 11 | PROMPT-NATURAL-LANGUAGE-ROUTE | 2 | "configure pstack models" loads setup-pstack with no slash |

## Scores

`node score.mjs` produced this table from the raw transcripts (`runs/score.json`, `runs/score-tables.md`). Mandatory means every mandatory check passed in that attempt.

| Scenario | Cursor mandatory | Pi mandatory | Cursor outcome | Pi outcome | Cursor valid runs | Pi valid runs |
| --- | --- | --- | --- | --- | --- | --- |
| PROMPT-IN-YOUR-OWN-WORDS | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 |
| PROMPT-SHARPEN | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 |
| PROMPT-HELP-NO-WORK | 3/3 | 3/3 | 3/3 | 0/3 | 3/3 | 3/3 |
| PROMPT-BRO-FOLLOWUP | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 |
| PROMPT-NONTRIGGER-MENTION | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 |
| PROMPT-POTETO-MODE-ONE-MESSAGE | 2/2 | 2/2 | 2/2 | 1/2 | 2/2 | 2/2 |
| PROMPT-MODE-STICKY | 2/2 | 0/2 | 0/2 | 0/2 | 2/2 | 2/2 |
| PROMPT-HOW-READONLY-EXPLORERS | 0/2 | 2/2 | 0/2 | 2/2 | 0/2 | 2/2 |
| PROMPT-SHELL-STATE | 0/2 | 2/2 | 0/2 | 2/2 | 0/2 | 2/2 |
| PROMPT-SHELL-DEFAULT-BACKGROUND | 0/2 | 1/2 | 0/2 | 1/2 | 0/2 | 2/2 |
| PROMPT-NATURAL-LANGUAGE-ROUTE | 0/2 | 2/2 | 0/2 | 2/2 | 0/2 | 2/2 |

Every Cursor zero in rows 8 to 11 is the usage limit, not observed behavior. The per-check failure list is in `runs/score-tables.md`. Prose assertions that no check encodes, such as "uses simpler language" for `/bro`, are not machine-scored and stay UNVERIFIED.

## Per scenario

Evidence paths are relative to this directory. Durations are wall time per turn. With 2 or 3 attempts per side they describe the spread, not a performance claim.

**1 to 5 (2026-11-06 scenarios).** Both hosts pass every mandatory and outcome check except the `/poteto-help` link (Defect 1).
- Within-host variation is small. Cursor read one file in two help attempts and two in the third. Pi read `bro/SKILL.md` in one of three bro attempts. Every other repeat matched its siblings call for call.
- Cross-host difference, not a mandatory violation: Pi reads the attached skill's SKILL.md again, even though Pi already inlined it in a `<skill>` block. This happened in 3/3 in-your-own-words, 3/3 sharpen, and 1/3 bro attempts, for example `runs/01-PROMPT-IN-YOUR-OWN-WORDS-r1/pi/turn-1.stdout`. Cursor made no tool call in any of those attempts.
- Cursor took 6 to 39 s per turn and Pi took 3 to 31 s.

**6, `/poteto-mode` one message.** Mandatory 2/2 on both hosts. Both read `playbooks/investigation.md`, start the todo list with Investigation step 1, spawn one Task, and run git with bash (`runs/16-*`, `runs/17-*`). Cursor took 79 and 89 s, and Pi took 113 and 128 s.
- Pi outcome failed in `runs/17-PROMPT-POTETO-MODE-ONE-MESSAGE-r2/pi/turn-1.stdout`. The answer was complete, then the background Task's completion woke the agent again, and its last message is "No follow-up is needed." This is the same pattern as Defect 2, but for a background subagent. Cursor print mode gives no reference for that case, so it is UNVERIFIED.

**7, sticky mode.** This scenario is UNVERIFIED by design. Cursor has no headless Custom Mode. Cursor received `/mode poteto-mode` as plain text. Its model read poteto-mode's SKILL.md and said the mode was active (`runs/18-PROMPT-MODE-STICKY-r1/cursor/turn-1.stdout`). That is why Cursor's turn 2 passes.
- Pi failed mandatory 0/2. Turn 2 answered with two bash calls and opened no playbook or todo list.
- Cause: each turn is a separate `pi --mode json` process. Turn 1 runs only the `/mode` command and emits `entry_appended`. No assistant message follows, so no session file is written. Turn 2 then reports "No project session found with id ... creating a new session" (`runs/18-PROMPT-MODE-STICKY-r1/pi/turn-2.stderr`), and the mode is lost.
- A supplementary probe ran after the scored run and is not part of the table. It sent the same four messages through one `pi --mode rpc` process (`probe-sticky-rpc.mjs`, `runs-sticky-rpc/`). In that probe Pi passed mandatory 2/2: turn 2 read the playbook and opened the todo list. So `/mode` sticks within one process. It does not survive a one-shot command invocation.
- Outcome failed on both hosts, mostly because of the over-specified README.md check (see Assertion findings).

**8, `/how`.** Pi passed mandatory 2/2. It spawned 4 readonly generalPurpose Tasks in r1 and 8 in r2, where 4 were rejected for invalid models and retried. It took 394 and 338 s, and its replies had the Overview and How It Works sections.
- The partial Cursor r1 attempt is UNVERIFIED and invalid. Before the usage error it spawned 4 Tasks with subagentType `unspecified` (Cursor's generalPurpose) on `grok-4.7-high-fast` (`runs/20-PROMPT-HOW-READONLY-EXPLORERS-r1/cursor/turn-1.stdout`). That matches Pi's delegation shape. Cursor r2 failed before any tool call.

**9, shell state.** Pi passed mandatory and outcome 2/2. Two bash calls ran, and the second printed `/usr` and `probe=42` (`runs/22-*/pi`, `runs/23-*/pi`). Cursor is UNVERIFIED (usage limit). The 2026-11-07 shell probe (`../evidence/shell-probe-2026-11-07/`) observed the same state on Cursor with a different variable name, but it is not part of this corpus.

**10, default background move.** Both Pi attempts passed `timeout: null`. In both, the call returned "did not complete in 30000ms and was sent to the background", and AwaitShell followed.
- r1 passed mandatory. Its outcome failed only because of the trailing "No follow-up needed." turn (Defect 2).
- r2 failed `finished-observed` (`runs/25-PROMPT-SHELL-DEFAULT-BACKGROUND-r2/pi/turn-1.stdout`). AwaitShell returned "Task completed ... exit code: 0" with no output, and the model said FINISHED without ever reading it. Cursor's await result has the same no-output shape unless a regex is passed (`../evidence/shell-default-wait-2026-11-07/cursor-run-1.jsonl`). I read this as model variance, not a host defect.
- Cursor is UNVERIFIED (usage limit).

**11, natural-language route.** Pi passed mandatory and outcome 2/2. It read `skills/setup-pstack/SKILL.md` without a slash, wrote nothing, and named the four budgets. In r1 it also called AskQuestion, which returned "Questions skipped by the user" in json mode. Cursor is UNVERIFIED (usage limit).

## Cross-host mandatory-step differences

Only one attempt pair differs on mandatory steps with both sides valid: sticky mode, pairs 18 and 19. Cursor passed. Pi failed `turn-2-playbook-read` and `turn-2-todo-first-item-is-playbook-step-1`. Evidence is `runs/18-PROMPT-MODE-STICKY-r1/pi/turn-2.stdout`, `runs/18-PROMPT-MODE-STICKY-r1/pi/turn-2.stderr`, and the same files under `runs/19-*`. This scenario was pre-registered as not comparable, so it is reported as UNVERIFIED, not as a parity violation. The cause is the cross-process `/mode` loss described above.

No other scenario with a valid Cursor reference shows a mandatory difference. Scenarios 8 to 11 have no valid Cursor reference.

## Defects found in pi-pstack (main 0bb0d452)

1. **`/poteto-help` gives a local path, not the public source link.** Cursor's `pstack/skills/poteto-help/SKILL.md:13` says to give the user the file's public copy at `https://github.com/cursor/plugins/blob/main/pstack/<path>`. pi-pstack's line 13 says to give "the file's full path: the package directory followed by its path". All 3 Pi answers have no GitHub link, and all 3 Cursor answers have one (`runs/07-*`, `runs/08-*`, `runs/09-*`, `pi/turn-1.stdout` vs `cursor/turn-1.stdout`). The 2026-11-06 treatment fixed this, but that fix exists only in a stash and never landed.
2. **A background job the agent already awaited still wakes the agent.** In `runs/24-PROMPT-SHELL-DEFAULT-BACKGROUND-r1/pi/`, the second AwaitShell call returned "Task completed in 40423ms with exit code: 0". The model answered. Then pi-pstack injected a `pstack/shell` `<system_notification>` for the same task (`sessions/*.jsonl`, `custom_message`). That started an extra model turn whose text "No follow-up needed." became the final message. The AwaitShell contract says that observing a finished job with AwaitShell skips its notification. Cursor's reference run shows `task_notification` events with no extra assistant turn (`../evidence/shell-default-wait-2026-11-07/cursor-run-1.jsonl`).

Finding, not yet classed as a defect against Cursor: `/mode <skill>` sent alone in one `pi -p` or `--mode json` invocation is lost before the next invocation with the same session id (pairs 18 and 19). Cursor has no headless equivalent to compare against.

## Assertion findings

These scores are kept as recorded.

- `turn-4-reply-names-file` (sticky mode) required the reply to name `README.md`. Every reply on both hosts answered "1 file" correctly without naming it. The check was over-specified.
- `reply-names-count-and-author` passes on any "1". The author check carries the signal.
- `run-valid` counts a Cursor usage-limit exit as an invalid run. That is the intended reading, but it means rows 8 to 11 measure account quota on Cursor, not behavior.
- The capture in `probe-sticky-rpc.mjs` stops a turn at the first `agent_settled`. Background subagent results that arrive later fall into the next turn. That makes its outcome checks unreliable. Its mandatory checks look only at turn-2 tool calls, which are captured.

## Harness and custody

- One host process ran at a time, so OAuth refreshes through the symlinked `auth.json` could not race. The token's expiry moved forward during this work, and no attempt failed on auth.
- Every literal value in the user's auth file was scrubbed from retained text. A scan of the 588 retained files found 0 occurrences, and the runner reported `credentialLinksRemoved: true` for every attempt. A few `sk-` substrings remain inside encrypted reasoning blobs (`encrypted_content`, `thinkingSignature`) in Pi subagent transcripts. They are opaque model ciphertext, not credentials.
- `runs-smoke/` is the single harness smoke run of pair 13 made before the full run. It is retained and not scored.

## Rerun

From this directory, with the archive packed from main (`cd extensions/pi-pstack && npm pack --pack-destination /tmp/corpus-2026-11-07/pack`):

```sh
node run-corpus.mjs --archive /tmp/corpus-2026-11-07/pack/justjoshn-pi-pstack-0.15.36-pi.30.tgz \
  --plugin /Users/josh-desktop/src/experiments/plugins/pstack \
  --plugin /Users/josh-desktop/src/experiments/plugins/cursor-team-kit \
  --out runs-2 && node score.mjs --runs runs-2
```

To finish the Cursor side once usage resets, rerun only the blocked pairs into a new directory. Keep `runs/` unchanged.

```sh
node run-corpus.mjs --archive <same archive> --plugin <pstack> --plugin <cursor-team-kit> --out runs-cursor-resume \
  --only 20-PROMPT-HOW-READONLY-EXPLORERS-r1,21-PROMPT-HOW-READONLY-EXPLORERS-r2,22-PROMPT-SHELL-STATE-r1,23-PROMPT-SHELL-STATE-r2,24-PROMPT-SHELL-DEFAULT-BACKGROUND-r1,25-PROMPT-SHELL-DEFAULT-BACKGROUND-r2,26-PROMPT-NATURAL-LANGUAGE-ROUTE-r1,27-PROMPT-NATURAL-LANGUAGE-ROUTE-r2
node score.mjs --runs runs-cursor-resume
```

`--only` runs both hosts for each listed pair, in the pre-registered order.
