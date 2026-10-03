---
name: swarm
description: "Fan out N parallel workers, drain them, and return one report. Use for /swarm, 'swarm this', or parallel coverage, races, gauntlets, and exploration."
disable-model-invocation: true
---

# Swarm

Fan out N parallel workers. Default each worker to `environment: "cloud"` when the host contract shows a configured remote executor. Use a local worker when the task needs an app, simulator, credentials, transcripts, or IDE state available only on this machine. Verify a cloud worker's host, working directory, and exact commit SHA. This package's `environment: "cloud"` worker runs on a configured independent VM. Its receipt records the machine identity and exact checkout SHA. When no remote executor is configured, run the unit locally, say so, and record the fallback in the decision log and the reply. The Task tool never falls back silently. If a required machine is unavailable, mark the lane BLOCKED. They may cover separate slices, race the same brief, or mix both. The parent waits, aggregates, and returns one report.

## Start

Open a todolist with one entry per phase before launching anything.

1. Frame
2. Fan out
3. Aggregate
4. Report

## Phase A: Frame

1. State the done predicate and the artifact or report the swarm must return.
2. Choose the shape. Partition into slices, race N workers on identical briefs, or mix both. For a race or mixed shape, declare `first pass`, `rank all`, or `best-of` before spawning.
3. Set N from the user or derive it from the shape. N is the total worker count, not the current concurrency limit.
4. Pick the worker model from the `swarm workers` line in `~/.pi/agent/pstack/models.mdc`. If the rule or that line is missing, use `grok-4.7-xhigh-fast`. For `auto` or `inherit-parent`, omit `model` so the workers run on the parent model. If the Task tool rejects a slug, use the default and say so. If it rejects the default, use the closest valid slug of the same family from its error message. For a model race, name each arm's model up front.
5. Give each worker its own writable output when it writes. When workers verify or measure commits, each brief names the exact SHAs. A measurement brief also names the method (sample count, what one sample is, order). The worker records both in its result.

## Phase B: Fan out

Spawn all N workers in one message with `subagent_type: generalPurpose`, `run_in_background: true`, and the step 4 model, left unset for `auto` or `inherit-parent`, using the Pi `Task` tool. Default `environment` to `"cloud"` when the host contract shows a configured remote executor. Use `environment: "local"` only when the worker needs access to something on this machine, or when no remote executor is configured, and record that fallback. Use `environment: "cloud"` for a configured independent VM. Its receipt must match the expected machine identity and exact checkout SHA. If a required machine is unavailable, mark the lane BLOCKED.

When a worker must start from a non-default pushed branch, pass `cloud_base_branch`.

Every brief stands alone. Include the goal, scope, exact slice or race arm, how to verify, and what to report. Reports use `PASS`, `ISSUES`, or `BLOCKED` with evidence. A worker that can prove a defect reports `ISSUES` and lists every issue it can prove, not only the first.

If a worker drops out, proceed with N-1 and note it.

## Phase C: Aggregate

Read the terminal results. Drop a result that does not record the SHAs and method its brief names, and respawn that worker once. After a second miss, record a gap. Also drop a result that does not cover its named slice with evidence, and respawn that worker once. After a second miss, record a gap. A gap does not count as a pass. For coverage, every required slice needs a result. For a race, apply the selection rule declared up front. Use first pass, rank all, or best-of. Do not paste raw worker dumps.

Keep a compact result table, one-line evidenced issues, and explicit gaps or dropouts.

## Phase D: Report

Return one consolidated in-chat report with the table, issue one-liners, gaps or dropouts, and the race rule when used.
