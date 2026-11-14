# U52 bounded scope review

The goal is to separate upstream workflow parity from Pi-native evidence without changing what a real-model run executes. Existing attempt identities and results are immutable. Scores produced against U52 are re-scores.

## Receipt-only adaptation checks

The vendored upstream `extensions/pi-pstack/vendor/upstream-pstack/skills/poteto-mode/SKILL.md:124` says “Open a todolist whose first items are the matched playbook's steps, copied in verbatim, before any task-specific todos.” It also says “A step you choose not to do stays in the list with a one-line `skip: <reason>`.” It does not require registered receipts, receipt identifiers, hashes, or `pstack_evidence verify`.

The Pi adaptation `generated/skills/poteto-mode/SKILL.md:127` adds “Check a step as `- [x] N. <text> (evidence: <receipt id>)` once `pstack_evidence` `verify` passes for it.”

The existing `todo.<playbook>.done-steps-proven` checks enforce only this additional registered-receipt contract. They retain their identities, implementation, and all negative coverage, and are now adaptation-scoped. No replacement upstream TODO checks are added. The existing run, verbatim steps, initial state, resolution, skip, order, and sole-writer checks stay upstream-scoped. Their scope has not been re-reviewed by this receipt-only change.

The 21 playbooks are authoring-a-skill, autonomous-run, autopilot-full, autopilot-stack, babysit, bug-fix, eval, feature, hillclimb, investigation, multi-phase-plan, pause-safely, perf-issue, prototype, refactoring, runtime-forensics, session-pickup, shipping, trace-forensics, visual-parity, and worktree-cleanup.

`investigation.receipts-recorded` requires “four receipts are recorded under verification/receipts and re-verify”. Vendored upstream `poteto-mode/playbooks/investigation.md:14` requires “the investigation output” and, for an are-we-sure answer, “your real judgment with reasons.” The Pi-specific registered-receipt requirement comes from the added `pstack_evidence verify` sentence quoted above. This check is adaptation-scoped without weakening its four-receipt requirement.

`ship.fresh.each-verifier-recorded-its-own-receipt` has the same additional receipt requirement as `ship.each-verifier-recorded-its-own-receipt`. The adaptation `generated/skills/poteto-mode/references/worker-assignment.md:137` says “A writable worker saves it under its worker directory's `evidence/` and registers it with `pstack_evidence` `record`”. Vendored upstream `poteto-mode/playbooks/shipping.md:5` instead requires that each independent verifier “posts `PASS`, `PASS+NOTES`, or `FAIL` on that PR.” Both receipt checks are adaptation-scoped. Neither check's negatives change.

## Verification

`scope-contract.test.ts` failed before the scope changes with expected adaptation, received upstream. After the changes all three tests passed. Exit codes were 1 and 0. Logs are `/Users/josh-desktop/pstack-runs/u52/scope-{red,green}.log`.
