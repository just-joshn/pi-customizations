---
name: arena
description: "Spawn N parallel candidates at the same task, pick a base, graft the strongest parts of the losers into it. Use for /skill:arena, 'arena this', 'throw it in the arena', or when one attempt at a non-trivial artifact would lock in the wrong shape."
disable-model-invocation: true
---

# Arena

Write `TODO.md` with one `- [ ]` entry per phase (Frame, Fan out, Cross-judge, Pick, Graft, Verify) before launching anything.

## Phase A: Frame

Every candidate gets the same prompt, so the prompt is the contract.

1. State the artifact each candidate is producing.
2. Derive the rubric, 3-6 concrete gradeable criteria for what success looks like on *this* task. It is the picker's tool in Phase D. Candidates only see the task.
3. Pick the runners. Use the `arena runners` line in the `pstack-models` system-prompt section. Each entry is a `provider/id` model and a thinking level. If that line is missing, every runner runs on the session model, so omit `model`, and the arena is one model sampled N times. Say so plainly and never present it as a diverse panel. An `auto` or `inherit-parent` entry in this line means the session model, so omit `model` for it. If `pi_spawn` rejects a configured entry, run that seat on the session model and say so. Families go by the provider and model name, such as `anthropic/claude-*` or `openai/gpt-*`. If dropped seats leave fewer than two runners, add runners until there are two, or one when the line has one entry. Run each added runner on a remaining runner's model, or on the session model when none remain, and say so. Spawn more runners when the arena covers multiple design directions. Use the same model N times when the work is generation-bound rather than judgment-sensitive. Pick each worker's `thinking` level for the job, per the Spawned Pi workers section of the **poteto-mode** skill.
4. Give each candidate its own output location (a git worktree where possible, otherwise a directory inside the project that you pass as `cwd`). A worker cannot write shared `/tmp`. For a worktree, spawn the runner with `worktree: "arena-<slug>-<n>"` and `base: "<ref>"`. The worker commits its output there, and the worktree is at `<agent dir>/pstack-v2/jobs/<job id>/worktree`, per the **separate-before-serializing-shared-state** principle skill.

## Phase B: Fan out

Spawn all N workers in one message with N `pi_spawn` calls, each with the task, the path to the shared grounding, its own output path, and instructions to produce the artifact and a short rationale naming the alternatives it considered and what it rejected.

Each runner wakes you with its report when it exits. End your turn and let the wakes arrive, or call `tmux_jobs` with `action: "wait"`, before Phase C. If a candidate produces no output, proceed with N-1 and note the dropout.

## Phase C: Cross-judge

After all Phase B candidates complete, choose one model from the `arena cross-judge pool` line in the `pstack-models` system-prompt section. Spawn one judge with `pi_spawn` and `readonly: true`. The judge is never from the session model's family, as Phase A step 3 defines families. Try only the entries from another family, in pool order. An `auto` or `inherit-parent` entry is the session model, so it never judges. If `pi_spawn` rejects an entry, move to the next one. If that line is missing, or no entry from another family runs, skip the judge, pick the base alone in Phase D, and say so. If you do not know the session model, try the pool's entries in pool order and say that the family check did not run. The judge sees the rubric and the candidates by path label, scores each criterion, and recommends a base with rationale. It runs in parallel with your reading in Phase D. Don't spawn it while candidates are still writing.

## Phase D: Pick a base

Read every candidate end to end before picking. Score each against the rubric criterion by criterion, not on holistic feel, and compare with the cross-judge when Phase C ran one. Agreement on the base confirms the pick. Disagreement means one of you is biased or the rubric was ambiguous. Read both rationales before deciding.

Pick the base a future maintainer can extend most easily without breaking invariants. When two feel tied, prefer the cleaner boundary or smaller API, per the Laziness Protocol.

## Phase E: Graft

Walk each losing candidate once more for what is worth porting into the base, usually one or two things per candidate, not most of it. Fold each graft in by hand, per the **redesign-from-first-principles** principle skill, so the result stays coherent under one mental model. Don't paste mechanically.

If the candidates converge on one shape, that is strong agreement. Note it and ship the consensus shape. No graft is needed. If they wildly diverge, Phase A was under-specified. Reframe and re-run rather than averaging the divergence.

## Phase F: Verify

Verify the synthesized artifact like any other output, per the **prove-it-works** principle skill. If verification finds a problem the arena missed, either Phase A was wrong (re-frame and re-run) or a candidate caught it and you missed the graft (go back to Phase E). Don't paper over it.

## Outputs

One synthesized artifact, with a short synthesis note alongside naming the base and why, the cross-judge's verdict or that Phase C skipped the judge, each graft with its source candidate, what was rejected and why, any convergence or dropouts, and the verification result.
