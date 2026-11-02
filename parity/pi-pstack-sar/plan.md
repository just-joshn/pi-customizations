# SAR parity verification plan

## Goal

Match the pstack capabilities described in `/Users/josh-desktop/Documents/pstack-sar-report.md` through Pi mechanisms. Do not treat a historical observation about Cursor, a known defect, or an unresolved remote-service question as a feature to reproduce.

## Completion predicate

Every pstack capability described by the report has an implementation mapping and a reproducible check. Every difference has an explicit reason. The package suite, bundled executable tests with real TLC, Pi mechanism check, and real Pi command drives pass. A missing or inconclusive check is not full parity.

Literal identity with every statement in the report is impossible. The report identifies the subject as a Cursor plugin, names Cursor-only application internals, and explicitly records unknown runtime contracts. A Pi extension cannot simultaneously have that host identity. The verification record must distinguish behavioral equivalence from identity and from facts not established by the report.

## Workflow

1. Capture the clean checkout, package tests, and real Pi RPC baseline.
2. Audit runtime behavior and bundled content against the report in separate read-only investigations.
3. Map report sections, host contracts H1 through H24, findings F1 through F12, and unresolved questions to Pi implementations or explicit external constraints.
4. Fix each demonstrated mismatch separately. Reproduce it first and run its narrow check immediately after the change.
5. Verify the complete package, bundled scripts, real TLC on Temurin 25, installed resources, and Pi command behavior.
6. Review the changes and audit trail independently. Record unresolved constraints without a full-parity claim.

## Rigor and throughput checkpoint

This is a high-rigor audit because the request covers workflow prose, executable tools, process isolation, and external services. Two read-only explorers audited separate runtime and content slices. Implementation uses disjoint write ownership. The subscription worker owns its runtime modules and subscription tests. The parent owns packaging, documentation, provenance, and the other verification files. The completed instruction worker owned only its named skill and automation prose files. The existing baseline has 501 passing tests across 38 files. The command and mode drives pass through real Pi RPC.

The first broader check found a failing statechart symlink fixture. A direct reproduction shows that macOS resolves `/var` through `/private/var`, invalidating the fixture's relative target. Canonicalizing the fixture directory makes both launcher cases pass without changing the launcher.

The main expected cost is verification and requirement reconciliation, not a rewrite. Existing code already implements much of the requested behavior. Refactors require a demonstrated gap.
