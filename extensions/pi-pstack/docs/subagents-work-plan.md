# Subagent parity work plan

- [x] Read the Principles section of the poteto-mode skill.
- [ ] Phase A: Frame
- [ ] Phase B: Design the workflow
- [ ] Phase C: Run the loop
- [ ] Inventory every supplied source artifact and extract observable contracts.
- [ ] Compare source contracts with native pi implementation and behavioral tests.
- [ ] Reproduce each confirmed gap, implement the smallest correction, and verify it.
- [ ] Exercise foreground, background, continuation, cancellation, isolation, and nested delegation in native pi.
- [ ] Phase D: Keep the audit trail
- [ ] Phase E: Verify and hand back

## Completion predicate

Every capability supported by the supplied reconstruction has a source pointer, native pi implementation, and passing behavioral evidence. No unsupported or unverified capability counts as parity. Source observations that are themselves unverified remain separately identified. Existing workspace changes are preserved.

## Throughput checkpoint

Two read-only audit lanes partition definition and launch contracts from lifecycle and persistence. The coordinator captures the existing tests and type-check baseline and owns the source inventory and verification gate. Writers receive isolated worktrees if needed. Each confirmed gap starts with a failing regression and ends with its targeted check before combined verification.

## Baseline

The starting working tree contains substantial uncommitted subagent work. The initial pi-pstack run passed 81 test files and 666 tests. Type checking is in progress. These results establish a baseline, not source parity.
