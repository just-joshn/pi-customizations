---
name: swarm
description: "Fan out N parallel workers, drain them, and return one report. Use for /skill:swarm, 'swarm this', or parallel coverage, races, gauntlets, and exploration."
disable-model-invocation: true
---

# Swarm

## Start

Track a checklist with one entry per phase before launching anything.

1. Frame
2. Fan out
3. Aggregate
4. Report

## Phase A: Frame

1. State the done predicate and the artifact or report the swarm must return.
2. Choose the shape. Partition into slices, race N workers on identical briefs, or mix both. For a race or mixed shape, declare `first pass`, `rank all`, or `best-of` before spawning.
3. Pick the worker model and thinking level from the `swarm workers` line in `${PI_CODING_AGENT_DIR:-~/.pi/agent}/pstack-models.md`. If the rule or that line is missing, use `claude-opus-5-5` at `high`. Split the value at dispatch. Drop a trailing `-fast`, then the effort token (`xhigh`, `high`, `medium`, or `low`), pass the bare id as `model` and the token as `thinking`, and check the id against `pi --list-models`. A value with no token passes `model` only. For `auto` or `inherit-parent`, omit `model` and `thinking` so the workers run on the parent model. If a bare id is not registered, use the default and say so. If the default is missing, use the closest valid id of the same family from `pi --list-models`. For a model race, name each arm's model and thinking level up front. Pass each worker's thinking level per the Subagents section of the **poteto-mode** skill.
4. Give each worker its own writable output when it writes. When workers verify or measure commits, each brief names the exact SHAs. A measurement brief also names the method (sample count, what one sample is, order). The worker records both in its result.

## Phase B: Fan out

Spawn all N workers in one message with `subagent_type: "general-purpose"`, `run_in_background: true`, and the step 3 model, left unset for `auto` or `inherit-parent`. Give each writing worker its own git worktree or output path, and start from the required base branch when a worker must start from a non-default branch. Wait on them with `await_subagent`.

Every brief stands alone. Include the goal, scope, exact slice or race arm, how to verify, and what to report. Reports use `PASS`, `ISSUES`, or `BLOCKED` with evidence. A worker that can prove a defect reports `ISSUES` and lists every issue it can prove, not only the first.

If a worker drops out, proceed with N-1 and note it.

## Phase C: Aggregate

Read the terminal results. Drop a result that does not record the SHAs and method its brief names, and respawn that worker once. After a second miss, record a gap. A gap does not count as a pass. For coverage, every required slice needs a result. For a race, apply the selection rule declared up front. Use first pass, rank all, or best-of. Do not paste raw worker dumps.

## Phase D: Report

Return one consolidated in-chat report with a result table, issue one-liners, gaps or dropouts, and the race rule when used.
