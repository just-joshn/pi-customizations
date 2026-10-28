# Rationale (candidate A)

## Problem

Ship `extensions/pi-rea` as claimable 100% agent-facing parity with rea-agents 6.8.0 on Pi 1.4.0 without any runtime dependency on rea-agents. The agent-facing surface is 229 tools, 6 prompts, Evidence envelopes, a workflow skill, and verify/doctor digests against the oracle under `parity/pi-rea/`. An uncommitted sibling at `/Users/josh-desktop/src/personal/pi-rea/extensions/pi-rea` already owns a native `registerTool` scaffold for a stale 170-tool 6.4.0 contract with a working session/Evidence kernel. Main `skills/reverse-engineer-anything` already owns engine-free analyzers for a small subset. `extensions/AGENTS.md` demands Pi-native mechanisms and forbids a second agent loop. The non-obvious choice is how to absorb those two trees into one package while regenerating the catalog to 229 tools, keeping the large catalog off the default prompt, and failing closed for everything not yet implemented.

## Usage (caller's view)

See [USAGE.md](./USAGE.md). The consumer installs a Pi package, talks to kernel tools (and discovers deferred tools via `tool_search`), runs six prompt templates, and loads one skill. Maintainers regenerate `schemas/tool-contracts.json` from `parity/pi-rea/rea-6.8.0-tools-list.json` and add one family handler at a time. The three call sites in USAGE.md are the spec. The sketch derives from them.

## Shape

**Data structures first.** The load-bearing structure is a generated `ToolCatalog` of 229 `ToolContract` values. Each contract carries name, family, parameters, annotations, effects, surface, and `implementation: "kernel" | "unavailable"`. Pi exposure is derived (`kernel` → `direct`, else `deferred`), not stored in a second map (`per encode-lessons-in-structure`, `per model-the-domain`). Session state is one `ReaSession` per Pi session: active `TargetBinding`, `EvidenceLedger`, `UnknownLedger`, and a `binary_session` report that includes catalog digests and alignment. Evidence identity and unknown revisions live in those ledgers, not in ad hoc tool locals (`per foundational-thinking`).

**Flow.** Factory creates a `SessionHolder`, binds it on `session_start`, clears it idempotently on `session_shutdown`, registers `/rea`, and calls `registerAllTools`. Registration is one loop over the catalog. Execute paths go `registerTool.execute` → `dispatchTool` → `FamilyHandlers[name]` or family `fallback` → `capabilityUnavailable`. Result encoding (`operationResult` / `evidenceResult` / `errorResult`) sits at the Pi boundary. Analyzers and ledgers stay pure relative to Pi types (`per boundary-discipline`).

**Generator lever.** `generateCatalog(oracle, kernelManifest, families)` is the only path that invents the shipped contract. Titles, oracle prose, and output schemas stay out of the published descriptions where the sibling independence rules already require port-authored text. Digests feed `binary_session` and `check-contract` (`per build-the-lever`).

**Kernel vs deferred.** Kernel names come from `schemas/kernel-manifest.json` (seeded from the sibling's 14 implemented tools and the `session-evidence` family). Those register `direct` and activate. The remaining tools register `deferred` so the default prompt stays small (AGENTS.md tool-search / deferred guidance, `per laziness-protocol`). All session-touching tools use `executionMode: "sequential"` because one shared `ReaSession` writer is a real invariant (`per separate-before-serializing-shared-state`, `per make-operations-idempotent` for close/shutdown).

**Package resources.** Conventional Pi package: extension + `skills/reverse-engineer-anything` + six `prompts/*.md` named after REA MCP prompts. Zero `rea-agents` dependency. Peer-only Pi host packages.

**Absorption.** Sibling scaffold becomes the starting `extensions/pi-rea` tree. Main skill format analyzers move under `src/analysis/` and wrap as family handlers. The standalone skill is deleted after the package skill is the sole copy (`per outcome-oriented-execution`, `per subtract-before-you-add`, `per migrate-callers-then-delete-legacy-apis`).

**Interface depth.** Public surface for humans and models is install, kernel tools, prompts, skill, and `/rea`. Hidden behind that surface: 229-tool registration, exposure policy, fail-closed dispatch, Evidence identity, availability matrix, contract digests, and family extensibility. Callers do not coordinate load → validate → register stages. Maintainers implement one family without rewriting registration (`per minimize-reader-load`). Transport/MCP wire types never appear on the public API (`per type-system-discipline`, `per boundary-discipline`).

**Deliberately not done.** No MCP server wrapper. No npx/stdio to rea-agents. No second discovery registry. No activating all 229 as `direct`. No dual skill names. No inventing findings for unimplemented tools.

## Synthesis decision

Base is this candidate (A). Arena cross-judge scored A 30, C 26, B 24. Parent agreed. Graft branded session/`ToolOutcome`/kernel-manifest seed and prompt digests from B without MCP transport. Graft C’s generator discipline, availability codes, ≤3-file hit path, and promote-then-delete of the standalone skill scripts into `src/analysis/`. Reject MCP stdio, `mcp__rea__*` agent names, CLI-as-required dual API, and early 100% behavioral claims. Full record: `../synthesis.md`.

## Tradeoffs accepted

- We accept regenerating port-authored descriptions (and excluding oracle titles/examples) in exchange for independence and a clean-room license boundary.
- We accept deferred discovery friction (`tool_search` must be enabled) in exchange for a small default prompt under a 229-tool catalog.
- We accept sequential execution across REA tools in exchange for a race-free shared `ReaSession` without per-tool locks.
- We accept fail-closed `capability_unavailable` for most tools at ship time in exchange for honest parity claims and a clear ledger of gaps.
- We accept absorbing sibling + main skill into one package (planned intermediate breakage while paths move) in exchange for a single ownership tree instead of permanent dual maintenance.
- We accept a hand-maintained `kernel-manifest.json` in exchange for regenerating the oracle catalog without silently flipping exposure.

## Alternatives considered

- **Dynamic MCP server via `pi.registerMcpServer` pointing at a clean-room MCP process.** Hides process lifecycle and MCP protocol behind Pi MCP, but exposes callers to server connect timing, duplicate tool naming (`mcp__…`), and a second runtime to version. The public surface grows (server config, exposure at the server layer) while session/Evidence still need in-process state for a zero-rea-agents port. Rejected for this candidate because the forced direction is native `registerTool`, and AGENTS.md already prefers deferred native tools over custom discovery for large catalogs.
- **Activate the full 229 as `direct`.** Maximizes discoverability without `tool_search`, but dumps the entire catalog into every prompt and violates the rubric's "large catalog stays off the default prompt." Interface looks bigger while hiding less policy. Rejected.
- **Keep the main skill CLI as the execution engine and only register thin Pi tool wrappers.** Preserves analyzers with minimal move cost, but splits session/Evidence across Node CLI store and Pi session state, forces pass-through tools, and leaks two envelopes. Rejected as shallow and temporally split (`per design-red-flags`).

## Open questions and risks

- Which exact names belong in the first `kernel-manifest.json` beyond the sibling's 14. Should every `session-evidence` family tool be direct even before it is implemented?
- Do the six prompt template bodies need a fresh prompts/list capture at 6.8.0, or is the 6.4.0 name/argument set still digest-compatible with `prompts_sha256` in the 6.8.0 `binary_session` report?
- How strict is the independence rule for oracle `description` text. Port-rewritten summaries only, or may structural phrases be retained when they are interface facts?
- Should absorbed main-skill analyzers keep writing a `.rea` directory store, or must Evidence retention live only inside `ReaSession` / export bundles under Pi?
- What is the cutover plan for users who already installed the standalone `skills/reverse-engineer-anything` path once the package skill owns that name?

## Next implementation step

Land `extensions/pi-rea` by copying the sibling scaffold, add `scripts/generate-contracts.ts` + `kernel-manifest.json`, and regenerate `schemas/tool-contracts.json` so `counts.tools === 229` before writing any new analyzer.
