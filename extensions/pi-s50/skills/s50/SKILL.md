---
name: s50
description: Drive an S50 engineering run (feature, bug, frontend, external issue, or architecture survey) through the deterministic s50 coordinator to PR_READY with revision-bound evidence. Use when the user asks for an S50 run, mentions `.s50/`, or wants a change taken to PR-ready under strict top-50 skills.
---

# S50

The `s50` tool, the `/s50` command, and the `s50` shell command take the same argv and are the only writers of `.s50/`. Inside Pi, call the `s50` tool. Pi blocks the shell command, its source entry point, and any write to `.s50/` from bash, `write`, or `edit`.

## Loop

1. Call `s50` with `["status"]`. With no run, start one: `["feature", "<objective>", "--criteria", "a;b", "--consumer", "cli:<how the user runs it>"]` (or `bug`, `frontend`, `issue`, `survey`). With no registry lock, run `["registry", "refresh"]` first.
2. Call `["resume"]`. Its last line is the `nextAction` JSON.
3. Act on `nextAction.kind`, then record the result with `["apply", "<command json>"]`:
   - `invoke_skill`: apply `{"kind":"invoke_skill","skill":"<name>"}`. On `ok`, read that installed skill's SKILL.md and follow it; the next action is then the phase's own work.
   - `advance`: apply `{"kind":"advance","to":"<phase>"}`.
   - `work`: do the task it names.
   - `start_nodes`: start the listed nodes, one worker per workspace.
   - `review`: review every listed dimension, then apply `record_review`.
   - `verify`: measure each criterion through the named consumer route.
   - `freeze_revision`: apply `{"kind":"freeze_revision"}`.
   - `human_gate`: see Gates.
   - `done`: report the PR_READY revision and stop.
4. Repeat from step 2. An error result means exit code 1 (an error) or 2 (the command was refused or a check failed); read the reason and never work around it. Exit code 3 means the command was accepted and the run now waits on a human gate.

## Gates

- `user_workflow`: tell the user the exact action, for example `/skill:triage`, and stop. Never imitate a user-only skill. After the user finishes, the user applies `{"kind":"complete_user_workflow","skill":"<name>"}`.
- `missing_skill`: show the install command and stop.
- `decisions`: put the round to the user in the grilling format and record the answers with `answer_decisions`.
- `shared_understanding`: ask the user to confirm, then apply `confirm_understanding`.
- `seam_confirmation`: ask the user to confirm the seams, then apply `confirm_seams`.
- `authorization`: stop. Only the user grants force-push, merge, deploy, destructive deletion, publishing, public or customer messages, and sensitive disclosure.

Commands that record a user decision, and the `--capabilities` and `--installed` overrides, open a confirmation dialog when the tool applies them. Without a UI the tool refuses, and the user types the `/s50` command instead.

`["verify"]` lists the evidence for each criterion with every blocker, and `["explain"]` shows the recent decisions.

## References

- [feature.md](references/feature.md): clarification rounds, domain, architecture, prototype, TDD seams, graph.
- [bug.md](references/bug.md): diagnostic loops, root cause, promotion, INCONCLUSIVE.
- [frontend.md](references/frontend.md): design brief and guideline digests.
- [verification.md](references/verification.md): consumer routes, evidence, review, findings, failures, PR_READY.
- [registry.md](references/registry.md): registry refresh, show, verify.
