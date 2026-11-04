# Worktree plan-build handoff

## Goal

A Pi worktree plan builder must receive the reviewed plan's unfinished root todos before its first model request. Its native branch entries must retain those todos and the associated plan file across resume. Writable status updates must synchronize that file. A readonly resume may update its session list but must not write the plan file.

## Overview and ownership

`registerPlanMode` owns the plan file and the import rule. `registerTodoWrite` owns the session list. `registerTask.startBackground` owns the child process. `child-env.ts` already transfers launch identity through variables that it consumes and removes at module initialization.

The current build callback imports into the parent, then launches the worker with the body returned by `planBody`. The child therefore has neither a native todo list nor a saved-plan association. `plan-worker-baseline.txt` records two real Pi RPC failures at the missing child todo list.

Cursor desktop `acceptPlan` sets unfinished todos and sends `executePlanAction` with `planFileContent`. `_loadPlanExecutionData` includes metadata in that content. `reference-contracts.json` preserves the source and its hash. These observations establish a metadata handoff, not the remote service's full implementation.

## Data shape and candidates

The handoff is one optional `buildPlan` file path. The reviewed file stays authoritative. No second serialized todo shape crosses the process boundary.

1. Precreate the child transcript with `SessionManager.create` and custom entries. The public API accepts an ID but does not persist setup-only entries until a conversation message exists. Making this work would require a fabricated message, duplicate prompt handling, or manual transcript persistence. Reject it.
2. Transfer `buildPlan` through the existing consumed child-identity boundary. The plan module imports the file once at `session_start`, then persists ordinary `pstack/plan` and `pstack/todos` entries. Choose this. It keeps plan parsing in its owner and does not add a generic initialization API to Task or its RPC runner.
3. Tell the model to recreate the todos. Reject it. Instructions do not establish native state before the first request or retain the status-sync association.

## Implementation contract

`StartBackgroundOptions.buildPlan` passes through `Launch` to one child variable. The child consumes and deletes that variable with the other identity fields. `PlanModeOptions.buildPlan` imports once, validates the path inside the existing plans folder, and records an agent-mode plan association. Ordinary resumes restore native entries instead of re-importing stale statuses. Unrelated descendants do not inherit the handoff.

The index wires plan status synchronization only for writable children or the root. Readonly workers keep TodoWrite's existing session-local behavior without gaining a filesystem-write path through plan metadata.

## Verification

The actual Pi RPC test accepts the worktree build choice and observes the child's system prompt. It then resumes that worker and performs a status-only TodoWrite. Both writable and readonly cases must retain dependencies. Only the writable case may modify the plan file. The existing plan, Task, package, and repository checks remain required.

This does not reproduce Cursor's phase UI, hosted execution, or independent simultaneous builders mutating the same plan file.
