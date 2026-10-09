# u-no-comments-sicko-spawn report

## Status

**pass** for the spawn repair brief. Product change bridges file-backed pstack personas into the lowercase `task` `agent_type` registry. Linked Cursor+Pi pair shows both hosts `sickoSpawnSucceeded: true` and first-assistant-output catchphrase on the Sicko child. Ledgers untouched. No commit.

## Attempt IDs

| Side | Attempt ID | Note |
| --- | --- | --- |
| cursor | `f4cd66ea-5fcd-49fc-aa35-9789e6fcfddc` | Reused from fail pair (brief allows Cursor reuse). |
| pi | `c0cf9e02-9dd1-4c47-961a-b5a4d4029003` | Fresh PTY after product fix. |

Pair. `parity/evidence/no-comments/pair-no-comments-sicko-2.json`

Prior fail pair. `parity/evidence/no-comments/pair-no-comments-sicko-1.json`

## Product change (commit-worthy summary, not committed)

Root cause. Pi offered both capital `Task` (`subagent_type` + `readPersona`) and lowercase `task` (`agent_type` + agent registry). `/no-comments` asks for Comment Sicko. The model called lowercase `task` with `agent_type: "Comment Sicko"`. That name was not in the registry, so the host returned `Unknown agent_type` and the parent fell back to inline cleanup.

Fix. `extensions/pi-pstack/src/persona-agents.ts` builds plugin `AgentDefinition`s for file-backed personas (including both `Comment Sicko` and `comment-sicko`). `SubagentFactory.registryInputs` prepends them to discovered custom agents so lowercase `task` resolves and lists them.

Tests. `test/persona-task-agents.test.ts` plus updated scheduler/commands/journey checks. Targeted suite green. Full `bun run test` still has one pre-existing failure in `parity-generator-playbooks.test.ts` (Cursor noun ban, unrelated to this change).

## Sicko spawn + catchphrase

| Side | sickoSpawnSucceeded | Catchphrase FIRST-OUTPUT |
| --- | --- | --- |
| cursor | **yes** | **yes** in child `139f27a2…` (exact first assistant text). |
| pi | **yes** | **yes** in child `agent-55da7a33…` (exact first assistant text `Yes... Ha ha ha... Yes!`). |

Pi measured. Session tool order `bash`, `task`, `bash`. No `Unknown agent_type`. Parent done line `delete-count=7 sicko=yes catchphrase=no` (parent PTY did not show the catchphrase; child transcript did). Cleanup 7→0 held.

## Commands run

1. Inspected fail pair session. Confirmed both `task` and `Task` were active; model used `task` + `Comment Sicko`.
2. Added failing unit tests, then `persona-agents` bridge + factory wiring.
3. `bun run test test/persona-task-agents.test.ts test/subagents-scheduler.test.ts test/subagents-commands.test.ts test/subagents-agent-registry.test.ts` (pass).
4. `node parity/scripts/capture-no-comments-sicko.mjs --pi-only` → attempt `c0cf9e02…`.
5. Re-read Pi parent session and Sicko child transcript for spawn success and first-output catchphrase.
6. Wrote pair-2 + this report. No ledger edits. No commit.

## Suggested follow-ups for the coordinator

1. Merge pair-2 into family-05 / `cmd-no-comments-sicko`. Close `NO-COMMENTS-SICKO-SPAWN`. Mark `PSTACK-CMD-NO-COMMENTS-SICKO-001` and `PSTACK-CMD-COMMENT-SICKO-FIRST-OUTPUT-001` verified-pass-paired when oracle freeze allows.
2. Commit the product change on the worker branch when ready (`persona-agents.ts`, factory wiring, tests, journey script assert).
3. Optional. Prefer capital `Task` in skill chrome still; both paths now work for Comment Sicko.
