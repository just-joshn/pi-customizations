# U52 bounded scope review

The goal is to separate upstream workflow parity from Pi-native evidence without changing what a real-model run executes. Existing attempt identities and results are immutable. Scores produced against U52 are re-scores.

## Receipt-only adaptation checks

The vendored upstream `extensions/pi-pstack/vendor/upstream-pstack/skills/poteto-mode/SKILL.md:124` says “Open a todolist whose first items are the matched playbook's steps, copied in verbatim, before any task-specific todos.” It also says “A step you choose not to do stays in the list with a one-line `skip: <reason>`.” It does not require registered receipts, receipt identifiers, hashes, or `pstack_evidence verify`.

The Pi adaptation `generated/skills/poteto-mode/SKILL.md:127` adds “Check a step as `- [x] N. <text> (evidence: <receipt id>)` once `pstack_evidence` `verify` passes for it.”

The existing `todo.<playbook>.done-steps-proven` checks enforce only this additional registered-receipt contract. They retain their identities, implementation, and all negative coverage, and are now adaptation-scoped. No replacement upstream TODO checks are added. The existing run, verbatim steps, initial state, resolution, skip, order, and sole-writer checks stay upstream-scoped. Their scope has not been re-reviewed by this receipt-only change.

The 21 playbooks are authoring-a-skill, autonomous-run, autopilot-full, autopilot-stack, babysit, bug-fix, eval, feature, hillclimb, investigation, multi-phase-plan, pause-safely, perf-issue, prototype, refactoring, runtime-forensics, session-pickup, shipping, trace-forensics, visual-parity, and worktree-cleanup.

`investigation.receipts-recorded` requires “four receipts are recorded under verification/receipts and re-verify”. Vendored upstream `poteto-mode/playbooks/investigation.md:14` requires “the investigation output” and, for an are-we-sure answer, “your real judgment with reasons.” The Pi-specific registered-receipt requirement comes from the added `pstack_evidence verify` sentence quoted above. This check is adaptation-scoped without weakening its four-receipt requirement.

`ship.fresh.each-verifier-recorded-its-own-receipt` has the same additional receipt requirement as `ship.each-verifier-recorded-its-own-receipt`. The adaptation `generated/skills/poteto-mode/references/worker-assignment.md:137` says “A writable worker saves it under its worker directory's `evidence/` and registers it with `pstack_evidence` `record`”. Vendored upstream `poteto-mode/playbooks/shipping.md:5` instead requires that each independent verifier “posts `PASS`, `PASS+NOTES`, or `FAIL` on that PR.” Both receipt checks are adaptation-scoped. Neither check's negatives change.

## Prioritized canary and release candidates

The canary intersection was taken from `real/attempts9.tsv`, not from PASS counts. Mandatory release records consulted were `MX-TODO-PARITY`, `MX-WORKER-CONCURRENCY`, `MX-MCP`, `SCRIPT-WATCH-PR`, `MX-PR-REVIEW`, and `CONTAINER-WORKERS` in `extensions/pi-pstack/requirements/requirements.json`. Their links and applicability are unchanged.

`worker-concurrency.workers-get-their-own-pane-env` is adaptation-scoped. Upstream `swarm/SKILL.md:27` says “Spawn all N workers in one message” with “`environment: \"cloud\"`”. It does not require tmux or `$TMUX_PANE`. The check instead requires “each worker's $TMUX_PANE names its own pane”. Other concurrency and isolation checks remain upstream. The check remains INCONCLUSIVE on round 9 because no historical process-environment capture exists. New runs capture this on the host without asking the model to produce a marker.

`why-mcp.readonly-holds-beside-mcp` and `why-no-mcp.readonly-holds-beside-mcp` are adaptation-scoped. Upstream `why/SKILL.md:13` says “Every spawn is `generalPurpose` with `readonly: false` (agent mode)” and “Investigators still shouldn't write anything.” Pi's same line instead says “A readonly worker runs `git` and `gh` through `bash_readonly` and cannot write files.” The check requires that “the readonly investigator was refused a write”. Upstream forbids investigators from writing; it does not require an attempted write or host-enforced refusal. The upstream `no-writes` check remains unchanged. Negatives still reject a successful write and a missing refusal probe.

`why-mcp.parent-discovers-mcp` stays upstream-scoped. Upstream `why/SKILL.md:35` says “Before spawning investigators, list the available MCPs from the Cursor environment. Use the available-tools map when present.” Pi changes the discovery mechanism, not the obligation. The checker accepts either a supplied-tools identification or a list command.

`worker-concurrency.spawn-does-not-block` keeps the upstream overlap rule. Vendored `poteto-mode/SKILL.md:96` requires “`run_in_background: true`” because “a foreground call holds your turn while other reports wait”. Pi's `SKILL.md:99` adds “Keep working after the spawn returns”. Background overlap does not require inventing another independent tool call when the prompt assigns all work to workers. The existing overlap negative stays on `spawn-does-not-block`. Only the next-independent-tool-call rule moves into `worker-concurrency.parent-continues-independent-work`, an adaptation-scoped check. Its negative still rejects collecting immediately after the spawns. This is a rule split, not a change in the round-9 model's behavior.

`open.prose-skills-were-read-before-the-first-create` is left unchanged as an unreviewed mixed provenance candidate. Vendored `poteto-mode/playbooks/opening-a-pr.md:9` says “Write every PR title, description, and commit body with `/technical-writing`” and “then apply `/unslop`”. The checker observes skill reads as a proxy for this obligation. This bounded pass does not decide whether reading is a necessary or sufficient proxy.

Mixed candidates are not moved wholesale. In particular, `why-mcp.investigators-readonly-with-mcp` combines upstream fan-out and MCP inheritance with Pi workspace enforcement, and `orchestrate.a-watch-loop-follows-the-pr` combines upstream PR supervision with the adapted watcher primitive. They stay at their existing scope pending a separate rule-level review. All remaining provenance candidates are listed in `u52-unreviewed-provenance.md`; none is silently considered upstream-verified merely because its current default scope is upstream.

## Verification

`scope-contract.test.ts` failed before the scope changes with expected adaptation, received upstream. After the changes all three tests passed. Exit codes were 1 and 0. Logs are `/Users/josh-desktop/pstack-runs/u52/scope-{red,green}.log`.
