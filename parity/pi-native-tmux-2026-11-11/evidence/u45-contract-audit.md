# U45 lock and autopilot contract evidence

## Forge lock

The old `lock()` removed an existing lock after eight seconds without establishing ownership. U44's stable-inode write protocol therefore did not guarantee exclusive writes.

The fixture now preserves that eight-second acquisition deadline and exits explicitly on contention. It never reclaims a lock. It does not infer ownership from a PID, so PID reuse, namespace collisions, missing ownership metadata, and competing reclaimers cannot authorize deletion. A crashed holder leaves the fixture unavailable until its sandbox is cleaned up. This is deliberate fail-closed behavior.

`tests/workflow-parity/forge-cli.test.ts` drives the actual forge CLI in separate processes. A git wrapper pauses the holder inside its critical section for eleven seconds. The waiter must exit with an acquisition error without changing state, actions, or the lock. The holder then completes, and the only posted comment is its own. A second case starts two waiters against uncertain ownership metadata and requires both to fail without any mutation.

Both cases failed against the original fixture because waiters exited successfully. After the fix, all five forge CLI tests passed. Logs are `/Users/josh-desktop/pstack-runs/u45/lock-red.log` and `lock-green.log`.

The U44 `observed-contention-stable.mjs` cohort was adapted only for the U45 checkout, run ID, and a five-sample count. All five runs completed with one merge each, no failing checks, and no lock-error text in recorded sandbox artifacts. No sample was retried. The script, per-run reports, observations, and `cohort-summary.json` are in `/Users/josh-desktop/pstack-runs/u45/`. An initial Node invocation could not resolve `jiti` and ran no samples. Bun ran the cohort.

## Upstream contract audit

Paths below are relative to `extensions/pi-pstack/vendor/upstream-pstack/skills/`.

- `poteto-mode/playbooks/autopilot-full.md:3` requires a swarm that never wrote the code. Step 4 at lines 14-16 requires independent verifiers at the code-ready SHA, gates, live proof, diff audit, and checked receipts. Step 5 at lines 17-19 requires owner merges of verified code and current-head CI. None imposes a per-verifier model-family rule.
- `swarm/SKILL.md:20-23` defines the done predicate, swarm shape, worker model selection, and exact SHAs. Line 22 selects one configured worker model and explicitly permits parent inheritance. Lines 27-31 spawn the workers with that selected model and require evidence-bearing reports. Line 37 requires coverage for every slice. Neither an owner-family exclusion nor two families across lanes appears in this contract.
- Removed `wf.autopilot-full.full.family` from both the link map and `AUTOPILOT-VERIFIED-MERGE.tests`. Its named negative was already absent from the suite and its family restriction was unsupported.
- Removed `wf.autopilot-lanes.lanes.family` and `wf.autopilot-lanes.lanes.onefam` from the link map, the requirement's test list, and the lanes negatives. Removed the corresponding owner-family and family-count predicates and claims from the checker. No replacement requirement links were added.
- The positive lanes scenario now runs all three verifiers on `sim/grok-sim`, the owner's model, to exercise the allowed same-family case. Verifiers remain separate workers. The checker explicitly compares verifier identity against author identity rather than using family as a proxy.
- Retained exact-head assignments and posted verdicts, distinct verifier lanes, gates/live/audit coverage, simultaneous fan-out after code-ready, receipt auditing, gate-change proof, root countersign, merge authorization, and every remaining negative.
- Retained orchestrate's explicit different-family rule at `poteto-mode/playbooks/orchestrate.md:13`, including both orchestrate checkers and their same-family negatives.
- Retained the final audit-trail review's explicit different-family rule at `show-me-your-work/SKILL.md:67`, including `trail.reviewer-is-another-family` and its same-family negative. That final audit-trail review is not a per-lane autopilot rule.

## Verification before the final merge gates

The targeted autopilot, autopilot-contract, orchestrate, and history suites passed with 167 passing tests and 10 skipped tests. This includes the same-family lanes scenario and the retained cross-family negatives. The log is `/Users/josh-desktop/pstack-runs/u45/contracts-green.log`.

`node scripts/build-parity-manifest.mjs --save parity-results/local/vitest-darwin.json` exited 0 and no longer refused any links. Its underlying full run had 2,762 passing tests, 102 skipped tests, and one failure. The failure was the committed manifest's requirements freshness assertion, before rebuilding that manifest. The log and saved results are `/Users/josh-desktop/pstack-runs/u45/manifest-save.log` and `manifest-save-results.json`.

The manifest and status documentation were then rebuilt with that fresh local report plus the existing Linux report, using `build-parity-manifest.mjs --results` for both reports. Both local result files were restored and are not part of the change. The generated manifest faithfully retains the dirty local run and its freshness failure. It is not a claim that release evidence is current. The coordinator must record fresh results after merge.

The lint baseline check, TypeScript check, and `regen.sh` each exited 0 before the final merge gates. No assertion, test budget, or command deadline was loosened. The final gate results remain external run artifacts so recording them does not change the code under test.
