# U52 unreviewed provenance candidates

Source inventory is /Users/josh-desktop/pstack-runs/u51/candidate-sources.json. This is a provenance queue, not a finding that these checks are incorrectly scoped. The bounded decisions and quotations are in u52-scope-review.md. Existing upstream TODO checks were explicitly retained by the operator.

## how/SKILL.md

Provenance anchor: "`role: \"general\"` for explainers".

Status: unreviewed provenance candidates. Current scopes and checker behavior are unchanged.

- `how.explainer`.

## how/SKILL.md

Provenance anchor: "Every spawn is a `pstack_worker` worker with `workspace: { mode: \"readonly\"".

Status: unreviewed provenance candidates. Current scopes and checker behavior are unchanged.

- `how.readonly-enforced`.

## why/SKILL.md

Provenance anchor: "Otherwise run `pi mcp list`".

Status: unreviewed provenance candidates. Current scopes and checker behavior are unchanged.

- `why.mcp-discovery`.
- `why-no-mcp.parent-discovers-mcp`.

## why/SKILL.md

Provenance anchor: "Use the `mcp_servers` section of the system prompt".

Status: unreviewed provenance candidates. Current scopes and checker behavior are unchanged.

- `why.mcp-discovery`.

## why/SKILL.md

Provenance anchor: "**Do not set `capabilities.mcp: \"none\"`.**".

Status: unreviewed provenance candidates. Current scopes and checker behavior are unchanged.

- `why.investigators`.
- `why-mcp.investigators-readonly-with-mcp`.
- `why-no-mcp.investigators-readonly-with-mcp`.

## why/SKILL.md

Provenance anchor: "A readonly worker runs `git` and `gh` through `bash_readonly` and cannot write files".

Status: unreviewed provenance candidates. Current scopes and checker behavior are unchanged.

- `why.readonly-enforced`.

## poteto-mode/SKILL.md

Provenance anchor: "Start the run with `node <pi-pstack>/scripts/start-run.mjs".

Status: unreviewed provenance candidates. Current scopes and checker behavior are unchanged.

- `reads.investigation.poteto-mode-and-playbook`.
- `todo.investigation.run-from-playbook`.
- `todo.investigation.steps-verbatim-in-order`.
- `todo.investigation.initial-states-open`.
- `todo.investigation.every-step-resolved`.
- `todo.investigation.resolved-in-order`.
- `reads.feature.poteto-mode-and-playbook`.
- `todo.feature.run-from-playbook`.
- `todo.feature.steps-verbatim-in-order`.
- `todo.feature.initial-states-open`.
- `todo.feature.every-step-resolved`.
- `todo.feature.resolved-in-order`.
- `reads.bug-fix.poteto-mode-and-playbook`.
- `todo.bug-fix.run-from-playbook`.
- `todo.bug-fix.steps-verbatim-in-order`.
- `todo.bug-fix.initial-states-open`.
- `todo.bug-fix.every-step-resolved`.
- `todo.bug-fix.resolved-in-order`.
- `reads.refactoring.poteto-mode-and-playbook`.
- `todo.refactoring.run-from-playbook`.
- `todo.refactoring.steps-verbatim-in-order`.
- `todo.refactoring.initial-states-open`.
- `todo.refactoring.every-step-resolved`.
- `todo.refactoring.resolved-in-order`.
- `reads.perf-issue.poteto-mode-and-playbook`.
- `todo.perf-issue.run-from-playbook`.
- `todo.perf-issue.steps-verbatim-in-order`.
- `todo.perf-issue.initial-states-open`.
- `todo.perf-issue.every-step-resolved`.
- `todo.perf-issue.resolved-in-order`.
- `reads.hillclimb.poteto-mode-and-playbook`.
- `todo.hillclimb.run-from-playbook`.
- `todo.hillclimb.steps-verbatim-in-order`.
- `todo.hillclimb.initial-states-open`.
- `todo.hillclimb.every-step-resolved`.
- `todo.hillclimb.resolved-in-order`.
- `reads.prototype.poteto-mode-and-playbook`.
- `todo.prototype.run-from-playbook`.
- `todo.prototype.steps-verbatim-in-order`.
- `todo.prototype.initial-states-open`.
- `todo.prototype.every-step-resolved`.
- `todo.prototype.resolved-in-order`.
- `reads.session-pickup.poteto-mode-and-playbook`.
- `todo.session-pickup.run-from-playbook`.
- `todo.session-pickup.steps-verbatim-in-order`.
- `todo.session-pickup.initial-states-open`.
- `todo.session-pickup.every-step-resolved`.
- `todo.session-pickup.resolved-in-order`.
- `reads.pause-safely.poteto-mode-and-playbook`.
- `todo.pause-safely.run-from-playbook`.
- `todo.pause-safely.steps-verbatim-in-order`.
- `todo.pause-safely.initial-states-open`.
- `todo.pause-safely.every-step-resolved`.
- `todo.pause-safely.resolved-in-order`.
- `reads.autonomous-run.poteto-mode-and-playbook`.
- `todo.autonomous-run.run-from-playbook`.
- `todo.autonomous-run.steps-verbatim-in-order`.
- `todo.autonomous-run.initial-states-open`.
- `todo.autonomous-run.every-step-resolved`.
- `todo.autonomous-run.resolved-in-order`.
- `reads.worktree-cleanup.poteto-mode-and-playbook`.
- `todo.worktree-cleanup.run-from-playbook`.
- `todo.worktree-cleanup.steps-verbatim-in-order`.
- `todo.worktree-cleanup.initial-states-open`.
- `todo.worktree-cleanup.every-step-resolved`.
- `todo.worktree-cleanup.resolved-in-order`.
- `reads.authoring-a-skill.poteto-mode-and-playbook`.
- `todo.authoring-a-skill.run-from-playbook`.
- `todo.authoring-a-skill.steps-verbatim-in-order`.
- `todo.authoring-a-skill.initial-states-open`.
- `todo.authoring-a-skill.every-step-resolved`.
- `todo.authoring-a-skill.resolved-in-order`.
- `reads.multi-phase-plan.poteto-mode-and-playbook`.
- `todo.multi-phase-plan.run-from-playbook`.
- `todo.multi-phase-plan.steps-verbatim-in-order`.
- `todo.multi-phase-plan.initial-states-open`.
- `todo.multi-phase-plan.every-step-resolved`.
- `todo.multi-phase-plan.resolved-in-order`.
- `reads.eval.poteto-mode-and-playbook`.
- `todo.eval.run-from-playbook`.
- `todo.eval.steps-verbatim-in-order`.
- `todo.eval.initial-states-open`.
- `todo.eval.every-step-resolved`.
- `todo.eval.resolved-in-order`.
- `reads.runtime-forensics.poteto-mode-and-playbook`.
- `todo.runtime-forensics.run-from-playbook`.
- `todo.runtime-forensics.steps-verbatim-in-order`.
- `todo.runtime-forensics.initial-states-open`.
- `todo.runtime-forensics.every-step-resolved`.
- `todo.runtime-forensics.resolved-in-order`.
- `reads.trace-forensics.poteto-mode-and-playbook`.
- `todo.trace-forensics.run-from-playbook`.
- `todo.trace-forensics.steps-verbatim-in-order`.
- `todo.trace-forensics.initial-states-open`.
- `todo.trace-forensics.every-step-resolved`.
- `todo.trace-forensics.resolved-in-order`.
- `reads.visual-parity.poteto-mode-and-playbook`.
- `todo.visual-parity.run-from-playbook`.
- `todo.visual-parity.steps-verbatim-in-order`.
- `todo.visual-parity.initial-states-open`.
- `todo.visual-parity.every-step-resolved`.
- `todo.visual-parity.resolved-in-order`.
- `reads.babysit.poteto-mode-and-playbook`.
- `todo.babysit.run-from-playbook`.
- `todo.babysit.steps-verbatim-in-order`.
- `todo.babysit.initial-states-open`.
- `todo.babysit.every-step-resolved`.
- `todo.babysit.resolved-in-order`.
- `reads.shipping.poteto-mode-and-playbook`.
- `todo.shipping.run-from-playbook`.
- `todo.shipping.steps-verbatim-in-order`.
- `todo.shipping.initial-states-open`.
- `todo.shipping.every-step-resolved`.
- `todo.shipping.resolved-in-order`.
- `reads.autopilot-full.poteto-mode-and-playbook`.
- `todo.autopilot-full.run-from-playbook`.
- `todo.autopilot-full.steps-verbatim-in-order`.
- `todo.autopilot-full.initial-states-open`.
- `todo.autopilot-full.every-step-resolved`.
- `todo.autopilot-full.resolved-in-order`.
- `reads.autopilot-stack.poteto-mode-and-playbook`.
- `todo.autopilot-stack.run-from-playbook`.
- `todo.autopilot-stack.steps-verbatim-in-order`.
- `todo.autopilot-stack.initial-states-open`.
- `todo.autopilot-stack.every-step-resolved`.
- `todo.autopilot-stack.resolved-in-order`.
- `reads.orchestrate.poteto-mode-and-playbook`.
- `todo.orchestrate.run-from-playbook`.
- `todo.orchestrate.steps-verbatim-in-order`.
- `reads.opening-a-pr.poteto-mode-and-playbook`.
- `todo.opening-a-pr.run-from-playbook`.
- `todo.opening-a-pr.steps-verbatim-in-order`.

## poteto-mode/SKILL.md

Provenance anchor: "A step you choose not to do stays in the list as".

Status: unreviewed provenance candidates. Current scopes and checker behavior are unchanged.

- `todo.investigation.every-step-resolved`.
- `todo.investigation.skips-explained`.
- `todo.feature.every-step-resolved`.
- `todo.feature.skips-explained`.
- `todo.bug-fix.every-step-resolved`.
- `todo.bug-fix.skips-explained`.
- `todo.refactoring.every-step-resolved`.
- `todo.refactoring.skips-explained`.
- `todo.perf-issue.every-step-resolved`.
- `todo.perf-issue.skips-explained`.
- `todo.hillclimb.every-step-resolved`.
- `todo.hillclimb.skips-explained`.
- `todo.prototype.every-step-resolved`.
- `todo.prototype.skips-explained`.
- `todo.session-pickup.every-step-resolved`.
- `todo.session-pickup.skips-explained`.
- `todo.pause-safely.every-step-resolved`.
- `todo.pause-safely.skips-explained`.
- `todo.autonomous-run.every-step-resolved`.
- `todo.autonomous-run.skips-explained`.
- `todo.worktree-cleanup.every-step-resolved`.
- `todo.worktree-cleanup.skips-explained`.
- `todo.authoring-a-skill.every-step-resolved`.
- `todo.authoring-a-skill.skips-explained`.
- `todo.multi-phase-plan.every-step-resolved`.
- `todo.multi-phase-plan.skips-explained`.
- `todo.eval.every-step-resolved`.
- `todo.eval.skips-explained`.
- `todo.runtime-forensics.every-step-resolved`.
- `todo.runtime-forensics.skips-explained`.
- `todo.trace-forensics.every-step-resolved`.
- `todo.trace-forensics.skips-explained`.
- `todo.visual-parity.every-step-resolved`.
- `todo.visual-parity.skips-explained`.
- `todo.babysit.every-step-resolved`.
- `todo.babysit.skips-explained`.
- `todo.shipping.every-step-resolved`.
- `todo.shipping.skips-explained`.
- `todo.autopilot-full.every-step-resolved`.
- `todo.autopilot-full.skips-explained`.
- `todo.autopilot-stack.every-step-resolved`.
- `todo.autopilot-stack.skips-explained`.

## poteto-mode/SKILL.md

Provenance anchor: "You are its only writer".

Status: unreviewed provenance candidates. Current scopes and checker behavior are unchanged.

- `todo.investigation.parent-sole-writer`.
- `todo.feature.parent-sole-writer`.
- `todo.bug-fix.parent-sole-writer`.
- `todo.refactoring.parent-sole-writer`.
- `todo.perf-issue.parent-sole-writer`.
- `todo.hillclimb.parent-sole-writer`.
- `todo.prototype.parent-sole-writer`.
- `todo.session-pickup.parent-sole-writer`.
- `todo.pause-safely.parent-sole-writer`.
- `todo.autonomous-run.parent-sole-writer`.
- `todo.worktree-cleanup.parent-sole-writer`.
- `todo.authoring-a-skill.parent-sole-writer`.
- `todo.multi-phase-plan.parent-sole-writer`.
- `todo.eval.parent-sole-writer`.
- `todo.runtime-forensics.parent-sole-writer`.
- `todo.trace-forensics.parent-sole-writer`.
- `todo.visual-parity.parent-sole-writer`.
- `todo.babysit.parent-sole-writer`.
- `todo.shipping.parent-sole-writer`.
- `todo.autopilot-full.parent-sole-writer`.
- `todo.autopilot-stack.parent-sole-writer`.
- `todo.orchestrate.parent-sole-writer`.
- `todo.opening-a-pr.parent-sole-writer`.

## poteto-mode/SKILL.md

Provenance anchor: "A `pstack-worker` wake message reports each worker that settles".

Status: unreviewed provenance candidates. Current scopes and checker behavior are unchanged.

- `investigation.settled-and-collected`.
- `feature.settled-and-collected`.
- `bug-fix.settled-and-collected`.
- `refactoring.settled-and-collected`.
- `perf-issue.settled-and-collected`.
- `hillclimb.settled-and-collected`.
- `plan.settled-and-collected`.
- `eval.settled-and-collected`.
- `rt.settled-and-collected`.
- `vp.settled-and-collected`.
- `headless-print.worker-settled-and-woke-parent`.
- `headless-print.no-state-lost`.
- `headless-json.worker-settled-and-woke-parent`.
- `headless-json.no-state-lost`.
- `codemode.settled-and-collected`.
- `worker-concurrency.settled-and-collected`.
- `worker-interaction.settled-and-collected`.
- `gates.settled-and-collected`.
- `feature-contested.settled-and-collected`.
- `automate-me.settled-and-collected`.
- `maintain-verification-skill.settled-and-collected`.

## arena/SKILL.md

Provenance anchor: "Add one `TODO.md` entry per phase (Frame, Fan out".

Status: unreviewed provenance candidates. Current scopes and checker behavior are unchanged.

- `arena.phase-todos-before-fan-out`.

## arena/SKILL.md

Provenance anchor: "Spawn all N workers one after another without waiting".

Status: unreviewed provenance candidates. Current scopes and checker behavior are unchanged.

- `arena.candidates`.
- `arena.fan-out-without-waiting`.

## arena/SKILL.md

Provenance anchor: "Spawn one judge worker with `role: \"judge\"`".

Status: unreviewed provenance candidates. Current scopes and checker behavior are unchanged.

- `arena.judge`.

## architect/SKILL.md

Provenance anchor: "Add one `TODO.md` entry per phase".

Status: unreviewed provenance candidates. Current scopes and checker behavior are unchanged.

- `architect.phase-todos-before-work`.

## swarm/SKILL.md

Provenance anchor: "Add one `TODO.md` entry per phase".

Status: unreviewed provenance candidates. Current scopes and checker behavior are unchanged.

- `swarm.phase-todos-before-fan-out`.
- `swarm-race-first-pass.phases-before-launch`.
- `swarm-race-rank-all.phases-before-launch`.
- `swarm-race-best-of.phases-before-launch`.
- `swarm-second-miss.phases-before-launch`.

## swarm/SKILL.md

Provenance anchor: "`workspace: { mode: \"container\", inputCommit }`".

Status: unreviewed provenance candidates. Current scopes and checker behavior are unchanged.

- `swarm.container-tried-first`.

## swarm/SKILL.md

Provenance anchor: "When a worker needs access to something on the user's computer".

Status: unreviewed provenance candidates. Current scopes and checker behavior are unchanged.

- `swarm.container-tried-first`.

## swarm/SKILL.md

Provenance anchor: "or spawn returns `ContainerUnavailable`".

Status: unreviewed provenance candidates. Current scopes and checker behavior are unchanged.

- `swarm.container-refusal-is-ContainerUnavailable`.

## swarm/SKILL.md

Provenance anchor: "spawn it with `workspace: { mode: \"worktree\", inputCommit }` instead".

Status: unreviewed provenance candidates. Current scopes and checker behavior are unchanged.

- `swarm.falls-back-to-worktree`.

## swarm/SKILL.md

Provenance anchor: "Spawn all N workers one after another without waiting".

Status: unreviewed provenance candidates. Current scopes and checker behavior are unchanged.

- `swarm.fan-out-without-waiting`.
- `headless-print.worker-spawned`.
- `headless-json.worker-spawned`.
- `codemode.worker-ran-codemode`.
- `worker-concurrency.spawned-in-one-message`.
- `worker-concurrency.distinct-resolved-models`.
- `worker-concurrency.distinct-sessions-and-panes`.
- `worker-concurrency.distinct-worktrees-and-branches`.
- `worker-concurrency.no-worker-saw-anothers-files`.
- `worker-concurrency.assignments-differ-only-where-intended`.
- `swarm-race-first-pass.arms-spawned-together`.
- `swarm-race-rank-all.arms-spawned-together`.
- `swarm-race-best-of.arms-spawned-together`.

## create-verification-skill/SKILL.md

Provenance anchor: "Write `.pi/skills/verify-<app>/SKILL.md` with YAML frontmatter".

Status: unreviewed provenance candidates. Current scopes and checker behavior are unchanged.

- `verify-skill.registers-with-the-required-sections`.

## reflect/SKILL.md

Provenance anchor: "Three `pstack_worker` spawns, one after another without waiting".

Status: unreviewed provenance candidates. Current scopes and checker behavior are unchanged.

- `reflect.three-reviewers`.

## reflect/SKILL.md

Provenance anchor: "A readonly Pi worker keeps the MCP tools the operator authorized".

Status: unreviewed provenance candidates. Current scopes and checker behavior are unchanged.

- `reflect.three-reviewers`.

## reflect/SKILL.md

Provenance anchor: "find this conversation's Pi session file".

Status: unreviewed provenance candidates. Current scopes and checker behavior are unchanged.

- `reflect.reviewers-get-the-real-transcript`.

## reflect/SKILL.md

Provenance anchor: "One `pstack_worker` spawn, `role: \"general\"`".

Status: unreviewed provenance candidates. Current scopes and checker behavior are unchanged.

- `reflect.synthesizer`.

## reflect/SKILL.md

Provenance anchor: "Never edit a skill inside an installed Pi package".

Status: unreviewed provenance candidates. Current scopes and checker behavior are unchanged.

- `reflect.edits-a-project-copy-never-the-installed-package`.

## reflect/SKILL.md

Provenance anchor: "Reviewers return findings in their final reply".

Status: unreviewed provenance candidates. Current scopes and checker behavior are unchanged.

- `reflect.settled-and-collected`.

## show-me-your-work/SKILL.md

Provenance anchor: "Read this run's Pi session file (`$PI_SESSION_FILE`)".

Status: unreviewed provenance candidates. Current scopes and checker behavior are unchanged.

- `trail.audited-against-the-transcript`.

## poteto-mode/playbooks/session-pickup.md

Provenance anchor: "Do not glob across `~/.pi/agent/sessions/*/`".

Status: unreviewed provenance candidates. Current scopes and checker behavior are unchanged.

- `pickup.trail-read-inside-this-workspace`.

## poteto-mode/playbooks/autonomous-run.md

Provenance anchor: "Pick the wake mechanism as a watch loop".

Status: unreviewed provenance candidates. Current scopes and checker behavior are unchanged.

- `auto.watch-loop-re-arms-after-each-wake`.

## poteto-mode/playbooks/worktree-cleanup.md

Provenance anchor: "run it as a watch, a `kind: \"watch\"` worker".

Status: unreviewed provenance candidates. Current scopes and checker behavior are unchanged.

- `cleanup.audit-ran-as-a-watch-and-woke-the-parent`.

## poteto-mode/playbooks/authoring-a-skill.md

Provenance anchor: "1. Follow Pi's Agent Skills do".

Status: unreviewed provenance candidates. Current scopes and checker behavior are unchanged.

- `todo.authoring-a-skill.steps-verbatim-in-order`.
- `todo.authoring-a-skill.skips-explained`.

## poteto-mode/playbooks/authoring-a-skill.md

Provenance anchor: "Follow Pi's Agent Skills documentation".

Status: unreviewed provenance candidates. Current scopes and checker behavior are unchanged.

- `author.reads-pi-skills-docs`.
- `author.never-edits-the-installed-package`.

## poteto-mode/playbooks/multi-phase-plan.md

Provenance anchor: "Run `node <pi-pstack>/generated/skills/poteto-mode/scripts/check-plan.mjs <plan.md>`".

Status: unreviewed provenance candidates. Current scopes and checker behavior are unchanged.

- `plan.file-passes-the-validator`.

## poteto-mode/playbooks/multi-phase-plan.md

Provenance anchor: "Explore in workers with `role: \"poteto\"` and an explicit model".

Status: unreviewed provenance candidates. Current scopes and checker behavior are unchanged.

- `plan.exploration-in-poteto-workers`.

## poteto-mode/playbooks/eval.md

Provenance anchor: "Read each candidate's Pi session file under its worker directory".

Status: unreviewed provenance candidates. Current scopes and checker behavior are unchanged.

- `eval.chain-verified-from-session-files`.

## poteto-mode/playbooks/orchestrate.md

Provenance anchor: "Steer a worker only for a follow-up on the same work".

Status: unreviewed provenance candidates. Current scopes and checker behavior are unchanged.

- `worker-interaction.spawn-returns-an-attach-command`.
- `worker-interaction.pane-shows-the-worker`.
- `worker-interaction.typed-prompt-reaches-the-transcript`.
- `worker-interaction.typed-steer-lands-mid-run`.
- `worker-interaction.parent-steer-lands`.
- `worker-interaction.rpc-steer-lands-in-the-parent`.

## no-comments/SKILL.md

Provenance anchor: "Spawn a `pstack_worker` worker with `role: \"comment-sicko\"`".

Status: unreviewed provenance candidates. Current scopes and checker behavior are unchanged.

- `gates.comment-sicko-in-its-own-worktree`.

## no-comments/SKILL.md

Provenance anchor: "as `scope.patch` in the worker directory".

Status: unreviewed provenance candidates. Current scopes and checker behavior are unchanged.

- `gates.scope-patch-applied-first`.

## no-comments/SKILL.md

Provenance anchor: "then apply the accepted patch in the caller's checkout with `git apply`".

Status: unreviewed provenance candidates. Current scopes and checker behavior are unchanged.

- `gates.only-the-accepted-patch-is-applied`.

## arena/SKILL.md

Provenance anchor: "Add one `TODO.md` entry per phase".

Status: unreviewed provenance candidates. Current scopes and checker behavior are unchanged.

- `arena-dropout.phases-before-launch`.

## automate-me/SKILL.md

Provenance anchor: "Don't glob across `~/.pi/agent/sessions/*/`".

Status: unreviewed provenance candidates. Current scopes and checker behavior are unchanged.

- `automate-me.history-is-workspace-scoped`.

## automate-me/SKILL.md

Provenance anchor: "Ask structured multiple-choice questions in the conversation, with numbered options".

Status: unreviewed provenance candidates. Current scopes and checker behavior are unchanged.

- `automate-me.asks-a-structured-question`.

## automate-me/SKILL.md

Provenance anchor: "Apply the **unslop** skill and the Authoring a skill playbook's writing guidance to every line.".

Status: unreviewed provenance candidates. Current scopes and checker behavior are unchanged.

- `automate-me.reads-unslop-and-authoring-before-drafting`.

## poteto-mode/playbooks/babysit.md

Provenance anchor: "Run `drive` and `background` under a watch loop".

Status: unreviewed provenance candidates. Current scopes and checker behavior are unchanged.

- `babysit.watchers-are-watch-pr-workers`.

## poteto-mode/playbooks/shipping.md

Provenance anchor: "One verifier per PR, each a container worker".

Status: unreviewed provenance candidates. Current scopes and checker behavior are unchanged.

- `ship.one-container-verifier-per-pr-with-the-forge-capability`.
- `ship.fresh.one-container-verifier-per-pr-with-the-forge-capability`.

## poteto-mode/playbooks/shipping.md

Provenance anchor: "When spawn returns `ContainerUnavailable` or `ForgeUnavailable`, this step is blocked".

Status: unreviewed provenance candidates. Current scopes and checker behavior are unchanged.

- `ship.blocked.spawn-is-refused-with-ContainerUnavailable`.
- `ship.blocked.spawn-is-refused-with-ForgeUnavailable`.

## poteto-mode/playbooks/shipping.md

Provenance anchor: "Report it blocked and land nothing".

Status: unreviewed provenance candidates. Current scopes and checker behavior are unchanged.

- `ship.blocked.lands-nothing`.
- `ship.blocked.reply-reports-blocked`.

## poteto-mode/playbooks/autopilot-full.md

Provenance anchor: "Assume the container dies".

Status: unreviewed provenance candidates. Current scopes and checker behavior are unchanged.

- `autopilot.full.owners-push-their-own-branch-and-keep-a-trail`.
- `autopilot.hold.owners-push-their-own-branch-and-keep-a-trail`.
- `autopilot.stack.owners-push-their-own-branch-and-keep-a-trail`.

## poteto-mode/playbooks/autopilot-full.md

Provenance anchor: "arm an hourly watch loop to audit until no delegated work is left".

Status: unreviewed provenance candidates. Current scopes and checker behavior are unchanged.

- `autopilot.full.hourly-watch-loop-armed-on-the-go`.
- `autopilot.hold.hourly-watch-loop-armed-on-the-go`.

## poteto-mode/playbooks/orchestrate.md

Provenance anchor: "Watch each PR with a watch loop".

Status: unreviewed provenance candidates. Current scopes and checker behavior are unchanged.

- `orchestrate.a-watch-loop-follows-the-pr`.

## poteto-mode/playbooks/opening-a-pr.md

Provenance anchor: "**PRs.** Run `/deslop` over the diff before commit".

Status: unreviewed provenance candidates. Current scopes and checker behavior are unchanged.

- `open.prose-skills-were-read-before-the-first-create`.
