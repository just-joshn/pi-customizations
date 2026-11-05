# Verify, confirm, and fact-check

All three passes were done by the same agent that wrote the changes. The operator forbade other agents, so no independent or cross-model reviewer took part. Branch `pstack-source-parity-2026-11-05`; its pull request lists the commits.

## Pass A: verify

- `make verify` exited 0 (`evidence/make-verify.txt`). Biome CI checked 1044 files with no findings, the Vitest convention scan found 0 violations, and pi-pstack's coverage suite passed 795 tests with 1 skipped. The other packages' suites and the fresh-install check also passed.
- `.pi/skills/verify-pi-customizations/bin/control-pi doctor`, `drive pstack-commands`, and `drive poteto-mode` passed against the installed `pi` 1.5.0.
- The branch diff touches 92 files, all under `extensions/pi-pstack/` or this folder. No raw Cursor code is committed; the extracted functions stay in the ignored `.audit/pstack-source-audit-2026-11-05/source/`.

## Pass B: confirm

- Every oracle was regenerated from the installed Cursor apps by running `capture-reference.mjs`, `extract-source.mjs`, and the five probes. All committed fixtures came back byte-identical except `cursor-tool-text.json`, whose parsed content is identical and which differs only in Biome's array formatting.
- `probe-task.mjs` asserts that desktop's Task description builder, run with the flags of a live CLI session, reproduces that session's text byte for byte. Source and runtime agree.
- `confirm-workflow.mjs` drove one multi-step workflow through the installed `pi` binary over RPC: a background `poteto-agent`, a refused follow-up while it ran, a `Shell_Agent` spelling resolving to `shell` with only `bash` and `bash_background`, `comment-sicko` reading Cursor's reminder, and the completion notice. All five checks passed (`evidence/confirm-workflow.json`).

## Pass C: fact-check

Findings, each corrected or recorded:

1. Earlier reports cited `5622.index.js`, `8008.index.js`, and `.audit/pstack-parity-2026-11-05/`; none exist on this host. They recorded Cursor desktop as absent; it is installed. Their labels that rest on those citations are unverified.
2. This run first stated that pstack never uses `fork`. That was wrong: `poteto-mode/playbooks/orchestrate.md` says "Fork when new work needs a worker's built state". The search pattern missed the plain word. Pi's Task `fork` serves that instruction, and its idle-source rule stays a recorded host difference.
3. Two mutation tests failed only by a thrown error or a 45-second timeout. Both were tightened to fail on an assertion within seconds.
4. An existing AskQuestion test asserted that every field models put in Cursor calls is a schema field. Desktop's schema declares no option description. The test now checks the declared fields against desktop's.
5. Tool-name scan of the reference text: `update_state` and `SendToUser` (make-bot-ui) and Slack posting tools (Benny) are Cursor-hosted. The first two remain hosted-automation gaps. Benny's Slack ban survives, renamed to Slack MCP tools, with a stricter Pi credential rule recorded as a difference.
6. Claims rechecked in source: the shell subagent flag (and its `false` value in the local-provider configuration), the interrupt flag, and explore's default model list.

## Not re-verified in this run

Custom modes, plan mode and CreatePlan text, `/loop`, skill references in messages, subscriptions and routines, background shell notifications other than AwaitShell, the readonly sandbox, worktrees, fork mechanics, Task failure text, and the 79 skill bodies beyond the lines changed here. Earlier runs covered them. Their evidence was not reproduced here, and some of it is missing.
