---
name: swarm
description: "Fan out N parallel workers, drain them, and return one report. Use for /skill:swarm, 'swarm this', or parallel coverage, races, gauntlets, and exploration."
disable-model-invocation: true
---

# Swarm

## Start

Write `TODO.md` with one `- [ ]` entry per phase before launching anything.

1. Frame
2. Fan out
3. Aggregate
4. Report

## Phase A: Frame

1. State the done predicate and the artifact or report the swarm must return.
2. Choose the shape. Partition into slices, race N workers on identical briefs, or mix both. For a race or mixed shape, declare `first pass`, `rank all`, or `best-of` before spawning.
3. Pick the worker model from the `swarm workers` line in the `pstack-models` system-prompt section. If that line is missing, or it says `auto` or `inherit-parent`, omit `model` so the workers run on the session model. If `pi_spawn` rejects the model, omit `model` and say so. For a model race, name each arm's model up front. A race with no configured lines runs every arm on the session model, so say plainly that it compares runs and not models. Pick each worker's `thinking` level for the job, per the Spawned Pi workers section of the **poteto-mode** skill.
4. Give each worker its own writable output when it writes. When workers verify or measure commits, each brief names the exact SHAs. A measurement brief also names the method (sample count, what one sample is, order). The worker records both in its result.

## Phase B: Fan out

Spawn all N workers in one message with N `pi_spawn` calls, each with a `worktree` branch of its own, named `swarm/<slug>-<n>`, and the step 3 model, left unset for `auto` or `inherit-parent`. Omit `worktree` when the worker needs access to something in the working directory that a fresh worktree lacks, such as uncommitted changes, or when the directory is not a git repository.

When a worker must start from a non-default branch, pass `base`.

Every brief stands alone. Include the goal, scope, exact slice or race arm, how to verify, and what to report. Reports use `PASS`, `ISSUES`, or `BLOCKED` with evidence. A worker that can prove a defect reports `ISSUES` and lists every issue it can prove, not only the first.

If a worker drops out, proceed with N-1 and note it.

## Phase C: Aggregate

Each worker wakes you with its report when it exits. End your turn and let the wakes arrive. Then read the terminal results. Drop a result that does not record the SHAs and method its brief names, and respawn that worker once. After a second miss, record a gap. A gap does not count as a pass. For coverage, every required slice needs a result. For a race, apply the selection rule declared up front. Use first pass, rank all, or best-of. Do not paste raw worker dumps.

## Phase D: Report

Return one consolidated report in your reply with a result table, issue one-liners, gaps or dropouts, and the race rule when used. Name each kept worktree branch in the report and delete the rest.
