# Latest pstack parity audit

## Scope and completion rule

The source for this update is `~/src/experiments/plugins/pstack` at commit `9511e60321f7e533a187d62854a3d53a53752874`, version 0.15.7. The previous package pinned `ecc249f1e306fc64ddf83c7bed16cacf7c2239db`, version 0.15.5. The upstream delta contains 19 changed files, including three new skills. The team-kit dependency has no changed files between those revisions.

This audit separates source delivery, executable host contracts, and model behavior. A delivered instruction does not prove that every model obeys it. A fixture for a service does not prove that a live service works. Complete parity requires every required contract to pass, with no unresolved external dependency. The strict historical audit still reports seven external-service clauses. This release does not claim absolute 100% behavioral parity.

## Update sequence

1. Capture the source delta and the existing verification failures.
2. Add failing tests for new workflows and changed policy contracts.
3. Refresh the changed source files and inventory, repair stale generator mappings, and regenerate resources.
4. Verify native discovery, prompt expansion, installed CLI behavior, and the existing lifecycle tests.
5. Reconcile evidence pointers and record external limits without changing their verdicts.

The run uses one writer in the checkout. A read-only architectural worker has a separate context. Exact-match generator checks make a stale mapping fail instead of silently dropping an adaptation. No new agent loop, discovery registry, provider protocol, or scheduler was added.

## Requirement matrix

| Upstream change | Pi-native delivery | Evidence | Verification scope |
| --- | --- | --- | --- |
| 0.15.7 plugin metadata and source distribution | Pinned provenance and SHA-256 inventory | `provenance.json`, `source-inventory.json`, `scripts/resources.mjs` | Reproducible source and generated-resource checks. |
| `/correct` | Skill and native prompt alias | `skills/correct/SKILL.md`, `prompts/correct.md`, `test/latest-workflows.test.ts` | Real resource loader and scripted session expansion through both entry points. Repo corrections remain a model workflow. |
| Benchmark checklist | Skill and native prompt alias | `skills/benchmark-checklist/SKILL.md`, `test/latest-workflows.test.ts` | Discovery and full instruction delivery. No performance improvement claim. |
| Explain the number principle | Hidden skill, explicit alias, router entry | `skills/principle-explain-the-number/SKILL.md`, `test/research-parity.test.ts`, `test/parity-generator-flags.test.ts` | Native visibility flags and router coverage. |
| Benchmark checks before perf and hillclimb measurements | Updated playbooks | `skills/poteto-mode/playbooks/perf-issue.md`, `skills/poteto-mode/playbooks/hillclimb.md`, `test/latest-workflows.test.ts` | Delivered checklist references and error/work-count requirements. |
| Fresh agents for new work and fix rounds | Updated mode and persona instructions | `skills/poteto-mode/SKILL.md`, `upstream/agents/poteto-agent.md`, `test/latest-workflows.test.ts`, `test/personas.test.ts` | Source policy delivery, including costly-state reuse exceptions. Existing resume capability remains available for those exceptions. |
| Hourly autopilot audits without implicit goals | `/loop 1h`, existing monitored shells, optional durable subscription path | `skills/poteto-mode/playbooks/autopilot-full.md`, `skills/poteto-mode/playbooks/autopilot-stack.md`, `host/skills/loop/SKILL.md`, `test/parity-generator-forge.test.ts` | Hourly instructions, 3600-second mapping, no obsolete goal completion, and existing shell/timer tests. No one-hour production program was run. |
| Per-unit pushes and fresh next owners | Updated autopilot briefs | `skills/poteto-mode/playbooks/autopilot-full.md`, `skills/poteto-mode/playbooks/autopilot-stack.md`, `test/latest-workflows.test.ts` | Policy delivery. No production PR merge performed. |
| Merge preparation allows harmless trunk movement | Preserved merge-tree, changed-path, CI-config, and patch-id gates | `skills/poteto-mode/playbooks/autopilot-full.md` | Source text delivered unchanged except documented host mappings. Live forge execution remains environment-dependent. |
| Hourly multi-phase plan contract | Updated skeleton and executable plan validator | `skills/poteto-mode/playbooks/multi-phase-plan.md`, `scripts/overlays/check-plan.mjs`, `test/helpers/check-plan.test.ts`, `test/parity-generator-paths.test.ts` | An actual plan passes with `/loop 1h` and fails when the marker is removed. Alternate trunk branches remain supported. |
| PR headings, separate changes and exclusions, built-in PR tool preference | Updated opening playbook, conditional native-tool use | `skills/poteto-mode/playbooks/opening-a-pr.md`, `test/latest-workflows.test.ts`, `test/parity-generator-forge.test.ts` | Instruction delivery. Pi has no built-in PR tool in this run, so the documented forge CLI fallback applies. |
| Respawn failed swarm lanes | Updated swarm workflow and native coverage guard | `skills/swarm/SKILL.md`, `test/parity-generator-placement.test.ts` | Fresh-worker policy delivery. |
| Schema-first cast proof | Updated TypeScript reference with tab-indented examples | `skills/typescript-best-practices/references/patterns.md`, `test/parity-generator-skills.test.ts` | Complete validators and removal of the obsolete hand-written guard adaptation. |
| Upstream writing-guide and README edits | Updated preserved source | `upstream/README.md`, `upstream/docs/guide`, `upstream/skills/technical-writing/SKILL.md` | Snapshot inventory and regenerated skill. |
| Truthful current status and no-worker verification | Existing status implementation and corrected journey selection | `src/context.ts`, `test/user-perspective.test.ts`, `scripts/verify-journeys.mjs`, `test/cli.test.ts` | Regression tests and installed CLI. The no-worker run records no Task call. |

## Source normalization

The existing snapshot uses generic host names. This update retains `Cursor` to `Reference`, `cursor-team-kit` to `team-kit`, and `.cursor` to `.upstream` substitutions. `.cursor-plugin` is stored as `plugin-metadata`. `provenance.json` names this convention. These files are normalized source snapshots, not byte-identical copies of the original plugin.

The first full comparison examined 161 pstack source files. After the base substitutions, 152 matched. The nine remaining differences already existed outside the latest delta. They are lowercase host-name substitutions in the Benny documentation and why skill, the helper package scope, and the restored GraphQL `endCursor` literal and matching helper fields. `scripts/check-latest-source.mjs` now names those legacy adaptations explicitly and verifies all 161 files against the actual pinned Git tree. Four isolated Git-fixture tests cover normalization, binary preservation, content drift, missing inventory, and invalid revision rejection. These files must not be described as pristine original source bytes.

`bun run check:resources` verifies 190 preserved files across pstack and team-kit and 211 generated resources. Native discovery includes 71 skills and 69 prompt templates when host resources are included.

## Verification record

- The initial eight latest-workflow tests failed before the source update and passed after regeneration.
- The targeted workflow, generator, dependency, research, and layering run passed 103 tests.
- The helper run passed 399 tests with no failures, including the real hourly plan-marker rejection and alternate-trunk checks.
- The real installed CLI passed command discovery, status, mode-off, and clean-shutdown checks without model calls.
- The no-worker CLI/RPC journeys passed 466 checks with no findings after a reproduced failure exposed three worker journeys in that selector.
- The real TUI passed status rendering and child-progress checks using a deterministic provider.
- Type checking, resource checks, agent compliance, and test conventions completed successfully. The conventions checker reports existing advisory notes.

The full CLI/RPC journey run passed 518 checks with no findings. The first full coverage run passed all assertions but failed on an unhandled stale-context rejection. A failing regression test showed that the SDK fixture omitted extension shutdown before disposal. Cleanup now delivers shutdown before invalidating the context. The fresh full run passed 1,645 tests across 183 files with one pre-existing intentional skip and no unhandled errors. Coverage passed the existing thresholds with 80.28% statements, 81.32% branches, 82.97% functions, and 83.18% lines. The native-first gate reported zero violations. Strict repository lint passed with no warnings. A final narrow helper run passed 65 plan and overlay tests after the last overlay edit.

The live-test historical ledger rerun completed with 482 clauses across four slices. All 475 locally verifiable clauses passed their evidence checks and named test runs. The other seven clauses remain external. `--allow-external` accepts those seven exclusions and no others. The strict gate still fails on them, so this is not an absolute parity pass. The separate subagent matrix gate resolves all 316 implementation and test-pointer rows, but that pointer check alone is not test execution evidence.

Local proof logs are retained under `.audit/latest-pstack/`. They include coverage, CLI/RPC journeys, TUI checks, strict lint, and plan tests. The source checker is included in this change so a reviewer can rerun it against the pinned upstream checkout. `git diff --check` reports one trailing space imported from upstream `README.md`; it is preserved so the source checker continues to match the upstream text.

## Historical ledger reconciliation

`docs/parity/reference.json` had a stale hash before this update. The actual reference document has 788 lines. The path-shortening commit `8076b0d` changed five path spellings without changing line ownership. The recorded hash also failed against the document from its original ledger commit `995b381`. The manifest now pins the actual retained document bytes. This does not make its historical statements current.

The clause ledger keeps its existing verdicts and ownership ranges. Evidence pointers now use current native test names, the latest swarm respawn wording, the hourly plan marker, and actual paths in the upstream checkout. The version clause explicitly distinguishes the historical reconstruction from the latest source. External clauses remain external. A `--no-tests` run checks pointers only and is not test evidence.

## Accepted completion scope

The user accepted verified Pi-native parity for the latest upstream changes, with external-service and proprietary-host limits documented. This supersedes the interim request to replace all cloud facilities locally. The seven external clauses stay external. They are not reclassified as verified, and this release does not claim absolute parity with proprietary hosted services.

The final cross-family review verified the current test and audit artifacts and reported no code-correctness, security, or Pi-ownership defects. Its one actionable documentation finding was the root README version and discovery counts. Those now match 0.15.7, 71 skills, and 69 prompt templates. Local review receipts are retained in `.audit/latest-pstack/trail-review-final.txt`.

## Remaining limits

Seven historical clauses require live Slack, issue-tracker, observability, or upstream marketplace services. Their credentials or host services are not available to the local verification run. Native package installation replaces upstream marketplace installation; it does not recreate that proprietary service.

Configured remote VM tasks, durable subscriptions, and reviewed webhook routine adapters exist in the current package. Their tests do not establish access to every deployment, provider entitlement, or business-service integration. Local readonly workers are not an OS sandbox. Source instructions and deterministic providers cannot prove identical stochastic decisions across Pi and the upstream host.

The decision trail is `docs/latest-parity-decisions.tsv`. The broader historical compatibility report is `docs/parity.md`. It is marked historical to avoid presenting its obsolete runtime statements as current release facts.
