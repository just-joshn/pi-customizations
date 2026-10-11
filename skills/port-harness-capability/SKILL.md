---
name: port-harness-capability
description: "Clean-room port of a capability from another AI coding harness (Claude Code, Codex, Cursor, OpenCode, Gemini CLI, and others): plugin, extension, skill, prompt, hook, rule, command, tool, or workflow. Reimplements it as a Pi-native extension, skill, prompt template, theme, or package with proven behavioral parity. Grounds the source behavior in evidence, designs the smallest Pi mechanism, builds and tests it through the real Pi CLI, keeps a machine-checked parity ledger, and reports VERIFIED, NOT VERIFIED, or INCONCLUSIVE. Invoke with /skill:port-harness-capability followed by the source harness, capability, references, and constraints."
license: MIT
compatibility: "Pi coding agent 1.1.0+. Bundled ledger validator requires Node.js 22.19+. Independent review uses separate `pi -p` processes."
disable-model-invocation: true
---

# Port a harness capability to Pi

You are the lead engineer. **This is an implementation assignment.** Do not stop at research, a design, a prototype, or recommendations. Ground, design, build, verify through the real Pi path, and report what the evidence establishes. Do not pause between stages unless you reach a real authorization boundary.

## Inputs

Parse the text after the command into these fields: source harness, capability name, capability type, source references, target repository (default: cwd), target artifact, required behavior, platforms, distribution (default: project-local), and constraints. **A blank input means unknown; it is not permission to invent.** Fill each input from evidence. Ask the user only when an external dependency or an irreversible decision blocks safe progress. For reversible choices, take the best default the evidence supports and record it in `decisions.md`.

## Workspace

Keep all port artifacts in `parity/<capability>/` in the target repository, unless an equivalent ledger already exists there:

- `spec.md`: the behavioral specification and scope boundary.
- `ledger.json`: the parity ledger. It is the source of truth. Use the schema in [references/ledger.md](references/ledger.md).
- `fixtures/`: redacted baseline captures. **Never fabricate a baseline.**
- `decisions.md`: design options, the selected design, the rejected alternative, and the evidence for each.
- `reviews/`: raw output from the independent reviewers.

## Non-negotiables

- **Clean room.** Reimplement behavior, never private implementation. Read [references/clean-room.md](references/clean-room.md) before you inspect any source.
- **Verify Pi APIs against the installed version.** Run `pi --version` and read its bundled `docs/` and `.d.ts` files. Never invent events, signatures, or settings.
- **Change nothing global.** Do not edit global Pi settings, install globally, publish, push, or delete without authorization. Run `git status` before editing, and preserve unrelated changes.
- **Report honestly.** Never claim a test, CLI session, comparison, install, or review that you did not perform. Compilation and lint never prove behavior. Never weaken, skip, or snapshot away a failing assertion.

## Stages

Complete each gate before moving to the next stage. Update `ledger.json` as you go.

1. **Ground.** Inspect the source docs and interfaces. If the source harness is runnable, exercise it, including negative and boundary cases. If its CLI surface is the subject, delegate the probing to `/skill:reverse-engineer-cli`. Inspect the target repo and Pi environment as described in [references/pi-mapping.md](references/pi-mapping.md#inspect-the-target). Write `spec.md` from [references/templates.md](references/templates.md#behavioral-specification), keeping fact, observation, inference, and unknown separate. Capture fixtures. Draw the scope boundary: include the integrations users depend on, and do not rebuild unrelated harness features.
   **Gate:** every known requirement has an ID, evidence, and confidence, and every material unknown is named.
2. **Design.** Map source concepts to Pi mechanisms by their semantics using [references/pi-mapping.md](references/pi-mapping.md). For each material decision, sketch **at least two structurally different designs** and compare their coverage, API fit, complexity, security, testability, packaging, and maintenance cost. Choose the simplest one that covers the full contract. Define the entities, state ownership, invariants, lifetimes, concurrency, idempotency, and validation boundaries.
   **Gate:** every requirement maps to a verified Pi API.
3. **Establish verification.** Write tests before implementation using the layers in [references/verification.md](references/verification.md). Each test should cite a requirement ID. When a CLI reference executable exists, reuse the differential approach from `/skill:implement-cli-from-contract`.
   **Gate:** the tests fail meaningfully against the missing behavior.
4. **Implement in verified units.** Build the smallest complete implementation, following the repo's conventions. After each unit, run its targeted tests, update the ledger, and resolve mismatches before moving on. Apply [references/security.md](references/security.md) at every boundary.
   **Gate:** each unit has passing checks and no unexplained deviation from the design.
5. **Integrate and harden.** Load the port through the real Pi CLI with `pi --skill`, `-e`, `--mode json|rpc`, and `pi install` as applicable. Exercise activation, commands, events, interaction, persistence, `/reload`, session switches, restarts, failures, and packaging install and removal.
   **Gate:** the actual user path works, and the lifecycle and security checks pass.
6. **Independent challenge.** Run three fresh reviewers as described in [references/verification.md](references/verification.md#independent-review). Reconcile every finding against real files and results.
   **Gate:** every material finding is fixed, refuted with evidence, or recorded as a gap.
7. **Final verification.** Rerun the full relevant suite on the final revision. Then run the validator:
   `node <this-skill-dir>/scripts/validate-ledger.mjs parity/<capability>/ledger.json --root .`
   It rejects any `VERIFIED` without an existing acceptance test file, any missing gap or reason, and any verdict stronger than the statuses allow. Regenerate the table with `--markdown`. Inspect the final diff, package metadata, and docs.
   **Gate:** the validator exits 0, and the reported verdict matches the final revision.
8. **Deliver.** Write the report using [references/templates.md](references/templates.md#final-acceptance-report).

## Verdict

Use exactly one of **VERIFIED**, **NOT VERIFIED**, or **INCONCLUSIVE**, and make it the verdict the validator derives. Use "100% parity" only when the verdict is VERIFIED. Report counts by status and list critical gaps separately. Never use a percentage to hide a missing critical behavior. Never upgrade INCONCLUSIVE because the implementation looks complete. If a check cannot run, report the exact blocker and its impact, and continue the work that does not depend on it.
