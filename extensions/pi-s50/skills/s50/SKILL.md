---
name: s50
description: Drive S50 engineering runs (feature, bug, frontend) through the deterministic s50 coordinator. Use when the user asks for an S50 run, mentions `.s50/`, or wants a feature, bug fix, or frontend change taken to PR-ready with gated evidence.
---

# S50

The `s50` tool (and `/s50` command) is the only writer of `.s50/` state. Same argv grammar everywhere: `s50 <subcommand> ...`.

## Loop

1. Load state: call the `s50` tool with `["status"]`. No run? Start one with `["feature"|"bug"|"frontend", "<objective>", "--consumer", "kind:path", "--criteria", "a;b"]`. A missing registry lock means run `["registry", "refresh"]` first.
2. Call `["resume"]`. Its last line is the `nextAction` JSON.
3. Act on `nextAction.kind`:
   - `invoke_skill`: apply `{"kind":"invoke_skill","skill":"<name>"}`. On `ok`, read that installed skill's SKILL.md and follow it. Record results with `["apply", "<command json>"]`.
   - `advance`: apply `{"kind":"advance","to":"<Phase>"}`.
   - `work`, `start_nodes`, `verify`, `freeze_revision`: do the work, then record it through `apply`.
   - `human_gate`: see Gates. `done`: report PR-ready revision and stop.
4. Repeat from step 2.

Human-only commands (`confirm_understanding`, `confirm_seams`, `grant_authorization`, `complete_user_workflow`) open a confirmation dialog when the tool applies them; without a UI the tool refuses and the user must type `/s50 apply ...`. Never edit `.s50/` files by hand. Never invent state the coordinator rejected: exit code 2 means rejected or blocked; read the reason.

## Gates

- `user_workflow`: tell the user the exact action, e.g. `/skill:triage`, and stop. Never imitate a user-only workflow (triage, improve-codebase-architecture, setup-matt-pocock-skills, grill-me, grill-with-docs, handoff, teach). After the user runs it, apply `{"kind":"complete_user_workflow","skill":"<name>"}`.
- `missing_skill`: show the install command; stop.
- `decisions`: ask a grilling round; record with `answer_decisions`.
- `shared_understanding`: ask the user to confirm; then `confirm_understanding`.
- `seam_confirmation`: ask the user to confirm seams; then `confirm_seams`.
- `authorization`: stop. Only the user grants force-push, merge, deploy, destructive deletion, public or customer messages, sensitive disclosure, or irreversible actions.

## References

- [feature.md](references/feature.md): phases, grilling rounds, design, TDD seams, graph.
- [bug.md](references/bug.md): diagnostic loops, root cause, promotion.
- [frontend.md](references/frontend.md): design checklist, guideline hash capture.
- [verification.md](references/verification.md): consumer routes, evidence, findings, PR-ready.
- [registry.md](references/registry.md): registry refresh, show, verify.
