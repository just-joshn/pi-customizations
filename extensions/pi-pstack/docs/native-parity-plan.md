# Native parity run

The target is functional parity with `/Users/josh-desktop/Documents/DOCS/pstack-reverse-engineering.md` on Pi. Every applicable requirement needs an implementation and reproducible evidence. Historical observations remain source facts. A host service cannot count as implemented through prose or a renamed local process.

## Workflow

- [x] Read the Principles section of the poteto-mode skill.
- [x] Phase A: Frame.
- [x] Phase B: Design the workflow. Independent review selected dedicated native roots with durable ownership and recovery.
- [ ] Phase C: Run the loop.
- [ ] Phase D: Keep the audit trail.
- [ ] Phase E: Verify and hand back.

## Audit coverage

- [x] Sections 1 to 3. Distribution, routing, playbooks, agents, executable helpers, runtime contracts.
- [x] Sections 4 to 5. Workflow algorithms, principles, models, craft skills.
- [x] Sections 6 to 8. Built-in dependencies, team-kit dependencies, consolidated risks, source inventory.
- [x] Capture baseline tests and resource checks.
- [ ] Add regression tests before each behavior change.
- [ ] Implement and verify each identified gap.
- [ ] Run native CLI journeys, coverage, type checking, generation checks, and independent review.

## Clause gate

The first manifest marked 2166 clauses verified with the same 10 to 15 file pointers, and 1356 of the reference's 3502 content lines had no clause. That design measured file existence. It is replaced.

`docs/parity/reference.json` pins the reference hash and eight contiguous slices. Each `docs/parity/clauses/<slice>.json` has one owner. `scripts/check-native-parity.mjs` derives the content lines from the reference, requires every line to fall inside a clause, and re-executes every check. A quote must exist in a native file. A test must pass in a fresh vitest, bun helper-suite, or real Pi CLI journey run. A historical fact must quote a preserved source or name an existing upstream commit. One quote may back at most 12 clauses. `gap`, `external`, and `unaudited` verdicts keep the gate failing by name. `docs/parity/AUDIT.md` is the auditors' contract.

## Throughput checkpoint

Three read-only investigators audit disjoint document sections while the coordinator checks the runtime and baseline. Writers will receive distinct file ownership. Implementation begins after the requirements have concrete evidence and verification methods.

## Definition of done

Every functional contract in the 5094-line reference has a native Pi implementation and an inspected verification result. Source history, manifest facts, and documented defects retain their source identity. Provider-specific model names map through explicit available provider configuration. No missing service, unknown discovery result, preserved prompt, or mock alone counts as a verified runtime capability.

## Designed execution units

1. Restore a trustworthy baseline against the current SDK. Verify corrected fixtures and actual RPC settlement.
2. Resolve native workflow contradictions through the resource generator. Verify generated resources and native skill authoring.
3. Implement durable timer subscriptions with fixed and dynamic cadence, cron, dedupe, change, list, and stop. Verify after the initiating process exits.
4. Implement native webhook routines and a server-side UI relay with secret input outside chat. Verify authenticated events, untrusted envelopes, worker wakes, and secret exclusion.
5. Implement configured remote execution with exact revision and machine identity evidence. Verify startup, steering, output, resume, stop, and isolation.
6. Port dormant Benny setup and execution contracts with reviewed drafts and disabled-by-default triggers. Verify local fixture flows without publishing or messaging external users.
7. Run the whole requirement audit, native CLI journeys, coverage, type checking, resource checks, and independent review.

## Baseline

At HEAD `48a085f5be038c514e1f86a8c29e2aa6b302972c`, the full suite had 340 passing tests, 11 failing tests, one skip, and two unhandled rejections. The type check and 187-source/205-resource check passed. The tests included stale session-manager mocks, pre-settlement RPC expectations, a obsolete history spy, and structure violations. After fixture corrections, the focused command/resource tests had 50 passes with the structure gate remaining. The actual detached RPC and integration suites then passed all 36 tests.

## Capability evidence still required

An isolated Lima Apple Virtualization VM is provisioned without host mounts. A real guest Pi process selected its fixture model, executed a turn at the exact requested Git SHA, persisted a completion snapshot, rejected a second simultaneous machine owner, and closed explicitly. The receipt is in native-parity-remote-evidence.json. Task tool integration and full remote lifecycle verification are still in progress. Slack/tracker deployment and real provider credentials remain unconfigured; fixture evidence is not live service evidence.
