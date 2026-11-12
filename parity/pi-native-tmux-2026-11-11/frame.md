# Pi-native pstack spec: frame and designed playbook

## Goal

pstack's workflows run natively in Pi. Workers are independent Pi processes that an operator can attach to in tmux and steer, and that survive a parent restart without a false pass or a duplicate writer.

## Grounding (observed 2026-11-11)

- `extensions/pi-pstack` is already this package at `0.15.36-pi.39`. It ships every upstream skill, playbook, and agent, plus the vendored team-kit skills, and keeps an audit harness under `parity/`.
- Upstream `5866df557357` (the spec's pin) changes nothing under `pstack/` or `cursor-team-kit/` relative to the pinned `6ea74587` (`git diff --stat` is empty). Counts at `5866df`: 58 skill dirs (24 `principle-*`), 23 playbooks, 2 agents. The spec's inventory matches.
- Pi 1.5.2 README line 19: "Pi ships with powerful defaults but skips features like sub-agents and plan mode. Ask Pi to build what you want, or install a package that does it your way."
- Subagents are already `pi --mode rpc` child processes (`src/task/runner.ts`). Local background agents are adopted by the main chat and end with it (`src/task/tool.ts:343`). Only cloud runs outlive the chat. No running agent can be attached to or steered.
- A prior run (session `01a1cd0c`) left a worker-host proof at `/private/tmp/pi-native-pstack-20261111/implementation` (branch `pstack/native-worker-proof-20261111`): `host.mjs` (317 lines), unexecuted. Its design and spec copies in this folder were lost.

## Premise attacked

The spec rests on one premise: that Task, TodoWrite, plan mode, and background shells in an extension violate Pi's design. Pi's README says the opposite. It leaves them out of core and points users to packages. Implementing the spec verbatim would delete working, audited parity code and rewrite every skill from `Task` to `pstack_worker`. That rewrite moves skill text away from upstream, which breaks the spec's own top rule ("leave pstack's decisions, sequencing, evidence standards and stop conditions intact").

## Real delta

1. A tmux worker host as the transport for local subagents. Attachable, accepts operator input, and survives the parent chat.
2. Restart reconciliation. On `session_start`, reconcile run records against live tmux sessions. A lost host is `unavailable`, never success. No second writer is launched.
3. Steering a running worker (RPC `steer`) and printing the attach command in `agent_status` and the Task result.
4. A spec-to-mechanism section in `docs/parity-status.md`, including the spec items declined and why.

## Declined from the spec (with reason)

- The `generated/` compile pipeline. The existing translation levers and `parity/` already pin and diff the source.
- Replacing `pstack-models.md` with `models.json`. The Markdown rule mirrors upstream's `.mdc` rule and already holds the same roles and budgets.
- Replacing `TodoWrite` with `TODO.md` and removing plan mode. Both carry upstream semantics, and Pi endorses package-provided versions.
- A new `pstack_worker` tool. `Task` already is the worker interface every skill calls.

## Definition of done (falsifiable)

With tmux present, a background local `Task` agent runs in tmux session `pstack-<agentId>`. All of the following are observed on real processes, using the scripted-model fixture and then one real model:

- `tmux attach` shows live output.
- Operator input and `steer` reach Pi, and the transcript records the effect.
- Killing the parent Pi leaves the worker running. A new parent session reconciles it and delivers its result once.
- Killing the worker host yields `unavailable` or `failed`, never a pass, and no duplicate writer.
- Without tmux, behavior equals today's (existing vitest suite unchanged).
- `verify-pi-customizations` passes.

## Rigor: high

Every skill depends on the subagent runtime, so the blast radius is total. The change is still reversible, because the transport is chosen per launch and today's path stays as the fallback. Gates are real-process tests plus the existing suite. A judge on a different model family reviews each PR.

## Designed phases (riskiest first)

- U0. Baseline harness. A script that launches a background agent, kills the parent, and records the outcome. Expected today: the agent dies. This becomes the old-vs-new check.
- U1. Worker-host proof. Finish and run the prior `host.mjs` against its 7 gates on real `pi --mode rpc`. Throwaway, in the `/tmp` worktree.
- U2 (PR 1). The host becomes the runner transport for local background agents when tmux exists.
- U3 (PR 2). `session_start` reconciliation, adoption of live hosts, and a single-writer lock.
- U4 (PR 3). `steer_agent` and attach commands in `agent_status` and Task results.
- U5 (PR 4). Docs and the parity-status mapping.

Fan-out: none across U1 to U3, because they share one host design and serialize on it. Code goes to the `hardest tasks` model. A judge from a different family reviews each PR.

## Checkpoint outcome

The operator chose the verbatim rebuild. The delta recommendation above stays on record. The phases below follow the spec's section 17, ordered riskiest first. Each phase lands as its own PR or PRs against `extensions/pi-pstack`, and nothing is published until phase 09 passes.

| Phase | Unit | Gate | Status |
| --- | --- | --- | --- |
| 02 | tmux host + `pi --mode rpc` worker | `proof/proof.mjs`, 11 gates on real processes | VERIFIED 11/11 on 3 runs (scripted model) |
| 01 | Source freeze and `parity-manifest.json` generator | 58 skills, 23 playbooks, 2 agents, scripts, Benny enumerated with hashes; every reference resolves | open |
| 03 | `vendor/` + `generated/` compile pipeline, span-aware transforms, `transformation-manifest.json` | regenerate is byte-stable; unmapped Cursor instruction fails the build | open |
| 04a | `pstack_worker` tool on the phase-02 host (spawn/inspect/steer/abort/collect), run files under `.pi/pstack/runs/` | real-process lifecycle tests, parent restart reconciliation | open |
| 04b | `TODO.md` generator (verbatim playbook steps), `models.json` + `/setup-pstack` | step order equals source; idempotent rewrite | open |
| 04c | Migrate skills off `Task`/`TodoWrite`/plan mode, then delete those tools | no skill references a removed tool; full suite green | open |
| 05 | Helpers: check-plan, watch-pr (Node wrapper, differential), worktree audit, decision log, statechart | upstream test suites pass | open |
| 06 | Workflow families end-to-end | one passing and one negative case per family | open |
| 07 | Forge adapter, Babysit modes, Shipping, Autopilot, Orchestrate, pause/pickup | merge-frontier and no-unauthorized-merge tests | open |
| 08 | Benny + webhook receiver | redelivery and crash-after-post exactly-once tests | open |
| 09 | Full parity + Pi-compliance gauntlet | all mandatory cases pass, limits documented | open |

Phase 04c is the one-way door. It removes tools this harness itself runs on, so it lands only after 04a carries every Task role (foreground, background, resume, fork, readonly, cloud) with passing tests.

Remaining open on the phase-02 proof:

- One run against a real model, not the scripted one.
- Proof against a real parent Pi session restarting. Today the controller is a plain script.
- The `--no-extensions` launch flag means a worker cannot yet load pstack skills. Phase 04a sets the real resource profile.
