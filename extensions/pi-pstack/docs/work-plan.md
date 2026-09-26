# Work plan

- [x] Read the Principles section of the poteto-mode skill.
- [x] Phase A: Frame
- [x] Phase B: Design the workflow
- [x] Phase C: Run the loop
- [x] Preserve the complete upstream plugin with file hashes and source revisions.
- [x] Compare two architecture candidates against source coverage, pi API correctness, lifecycle behavior, and honest host boundaries.
- [x] Implement skill commands, persistent mode, model configuration, and agent execution.
- [x] Exercise the actual pi loader and agent protocol. Record unsupported host contracts.
- [x] Phase D: Keep the audit trail
- [x] Phase E: Verify and hand back

## Completion predicate

Every file from the pinned pstack plugin is preserved. Every registered skill has a pi invocation. Executable adapters follow the pinned official pi API and pass behavioral checks. Every source requirement has a supported implementation or an explicit parity gap. Full parity is achieved only if no gaps remain. A passing asset inventory is not proof of full runtime parity.

## Throughput checkpoint

The source contains 47 registered skills, 23 playbooks, two agents, and an automation pack. Preserve the source mechanically. Inspect host-dependent contracts in parallel. Implement independent runtime modules only after the design comparison. Cursor services and external plugins are the primary unknowns. Review after source inventory, runtime implementation, and integration verification.

## Architecture steps

1. Ground
2. Sketch
3. Agree. Proceed without a human checkpoint for reversible work.
4. Implement
5. Scrap. Revisit if runtime evidence invalidates the design.

## Arena steps

1. Frame
2. Fan out
3. Cross-judge
4. Pick
5. Graft
6. Verify

The available agent tool provides GPT-family models only. The requested Claude and Grok review seats cannot run here. Independent GPT agents provide narrower evidence.

## Final disposition

Portable implementation and checks are complete. The full parity predicate is NOT VERIFIED because required Cursor services remain unmet. Phase E reports that failure explicitly rather than treating source preservation as full parity.
