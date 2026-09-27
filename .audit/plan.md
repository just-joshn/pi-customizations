# Comprehensive audit

- [x] Read the Principles section of poteto-mode.
- [x] Phase A: Frame.
- [x] Phase B: Design the workflow.
- [x] Phase C: Run the loop.
- [x] Capture baseline checks and current official documentation.
- [x] Frame, fan out, aggregate, and report three disjoint audit slices.
- [x] Fix reproduced security defects before other implementation work.
- [x] Resolve official API, validation, lifecycle, and parity defects with failing tests first.
- [x] Check whole-project rule applicability, executable helpers, generated resources, and reference evidence.
- [x] Phase D: Keep the audit trail.
- [x] Phase E: Verify and hand back.

Done means all confirmed applicable violations have fixes verified against real artifacts, with any irreconcilable requirements explicitly resolved by the user. No unavailable host behavior or stochastic model behavior is counted as verified.

Final checkpoint: all three audit slices and independent reviews completed. Baseline revision is 8cff868ca33e3c9e9acd668bf959e44cf45a4f59. Final `make verify` passed 61 extension tests, 43 Python tests, and 58 archived helper tests. Coverage and denominator details, approved conflicts, and remaining host limitations are in `extensions/pi-pstack/docs/comprehensive-audit.md`. Publication follows the user's subsequent request to commit the verified changes and open a PR.
