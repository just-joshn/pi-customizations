## Problem

pi-rea must present claimable 100% agent-facing parity with rea-agents 6.8.0 (229 tools, 6 prompts, Evidence envelopes, skill, verify/doctor semantics) on Pi 1.4.0 without any runtime dependency on rea-agents. Today that knowledge is split. Main `skills/reverse-engineer-anything/scripts` already owns a durable Evidence store, command table, envelope discipline, and several format analyzers. Sibling `extensions/pi-rea` owns a parallel in-process session, Mach-O/plist/PE readers, and `pi.registerTool` over a 170-tool 6.4.0-era contract. Phase A constraints that lock the shape. Pi-native mechanisms only (`registerTool`, deferred exposure, skill, prompts). No second agent loop. No MCP wrapper around rea-agents. Catalog must climb to the live 229-tool oracle under `parity/pi-rea/`. Absorb both trees without leaving two Evidence kernels. The non-obvious fork is where the kernel lives. This candidate puts it in one Node CLI and keeps Pi thin.

## Usage (caller's view)

Humans and scripts call `rea <command> --json` against a content-addressed store. The Pi model calls the same operations through generated `registerTool` entries whose `execute` paths invoke that kernel. Maintainers grow the catalog by editing `schemas/tool-contracts.json`, implementing or stubbing a kernel command, and running `generate-catalog`. See [USAGE.md](./USAGE.md) for the README path and three call sites (factory, generated execute, `runCommand`). The type sketch in [sketch.ts](./sketch.ts) is derived from those call sites.

## Shape

**Data structures first.** The load-bearing model is `ToolCatalog` (229 `ToolContract` rows) plus on-disk `Store` (immutable Evidence files, derived ledger, revisioned unknowns). Session memory is the store root bound to Pi `cwd`, not an in-memory `ReaSession` class that duplicates ledgers. Operation identity is a branded `OperationId`. Evidence identity is a content-addressed `EvidenceId`. Illegal combinations (envelope without limitations, retain without subject digest) are refused at `createEnvelope` / store boundaries. per `model-the-domain`, `type-system-discipline`, `foundational-thinking`.

**Flow.** Contract → `buildCommandTable` → `runCommand` / `invokeKernel` → format module → `createEnvelope` → `store.retain` → JSON outcome → (CLI stdout | `toPiToolResult`). Pi never imports format parsers. per `boundary-discipline`.

**Single SSOT.** CLI flags, Pi parameter schemas, capability matrix, and direct-vs-deferred exposure derive from the contract file via `generate-catalog`. That is the lever. Hand-syncing three catalogs is rejected. per `encode-lessons-in-structure`, `build-the-lever`.

**Shared state.** Sibling tool calls may run in parallel inside Pi. Writers do not share an in-memory ledger. They open the same store directory and serialize ledger updates with the existing lock; Evidence blobs never conflict because they are content-addressed. Prefer store-as-merge-boundary over a process-global session object. Adapter uses `executionMode: "sequential"` for mutating tools as a second belt. per `separate-before-serializing-shared-state`.

**Idempotency.** Re-retain of the same envelope increments `repeat_count` and does not fork identity. Import skips existing ids. `bindStore` and `session_shutdown` clear bindings without inventing a second lifecycle. Unavailable stubs always return the same `capability_unavailable` shape. per `make-operations-idempotent`.

**Interface depth.** Public surfaces are small. `rea` argv / `invokeKernel({ operation, args, storeRoot })` for all capability, and a thin `piRea` factory. Complexity (routing, integrity policy, envelope construction, lock discipline, 229-way fail-closed stubs) sits inside the kernel. Callers do not orchestrate retain-then-report. Call chain for a tool hit stays within three files (adapter invoke → command → format). per `laziness-protocol`, `minimize-reader-load`.

**Absorb, then delete.** Promote `skills/.../scripts` into `extensions/pi-rea/kernel`. Move sibling macho/plist/pe (and session semantics that are still needed) into kernel modules. Migrate Pi registration to generated adapters. Delete the parallel skill-scripts tree and the sibling in-process tool bodies as authoritative paths in the same wave. per `subtract-before-you-add`, `migrate-callers-then-delete-legacy-apis`, `outcome-oriented-execution`.

**Deliberate non-goals.** No MCP server process. No in-extension reimplementation of analyzers. No rea-agents import/spawn. No temporal split into load/validate/transform/save packages that restate envelope invariants.

## Synthesis decision

TBD (arena synthesis).

## Tradeoffs accepted

- We accept a subprocess or in-process bridge cost (and JSON boundary) in exchange for one testable kernel shared by CLI, skill workflows, and Pi tools.
- We accept regenerating adapter code from the contract in exchange for never hand-maintaining 229 `registerTool` blocks.
- We accept disk-backed session semantics (`.rea`) instead of a rich in-memory `ReaSession` object in exchange for crash recovery and a single memory model across CLI and Pi.
- We accept that deep analysis needing external engines stays `unavailable` stubs until a provider exists, in exchange for fail-closed honesty and a full advertised catalog.
- We accept sequential execution for mutating tools in exchange for simpler store correctness under Pi's parallel tool batches.
- We accept planned breakage while promoting scripts into the extension package in exchange for ending dual-kernel drift quickly.

## Alternatives considered

- **Pure in-process `registerTool` kernel (no CLI SSOT).** Hides less from maintainers who already use `rea` scripts. Forces a second entry point for humans, or abandons the CLI. Exposes callers to whichever stack the current file happens to live in. Rejected for dual-path drift and weaker human/script parity.
- **MCP server extension (`registerMcpServer` or stdio MCP).** Matches upstream's transport story and could advertise 229 tools in one blob. Exposes wire/MCP lifecycle to the Pi host and fights `extensions/AGENTS.md` native-first guidance when `registerTool` + deferred already solve catalog size. Adds a process boundary without absorbing the existing CLI kernel. Rejected for this candidate's forced direction and Pi-native depth.
- **Keep skill scripts and extension as peers with a shared npm lib.** Looks smaller up front. Leaves two packages to version and two paths for Evidence writes. Interface depth collapses because callers must know which surface owns the store. Rejected as a shallow split.

## Open questions and risks

- Should `invokeKernel` default to in-process `runCommand` (same isolate, better `AbortSignal`) or always spawn `rea` (harder isolation, clearer process boundary)?
- How closely must disk bundle schema `pi-rea.bundle.v1` match the reference MCP evidence-bundle field set for oracle diffs, versus a documented translation at export time?
- Which exact subset of the 229 is `direct` on day one without blowing the default prompt (session + evidence + unknowns + currently implemented inspectors only)?
- Does Pi 1.4.0 deferred + tool_search cover discovery well enough that namespace prompt guidelines can stay short?
- When absorbing sibling Mach-O/plist results, do we keep their projection shapes or normalize to the skill CLI envelope dialect first?

## Next implementation step

Promote `skills/reverse-engineer-anything/scripts` into `extensions/pi-rea/kernel`, add `schemas/tool-contracts.json` seeded from the 6.8.0 tools-list oracle with today's implemented rows marked `kernel`, and land `runCommand` + a single generated `registerTool` path for `capabilities` before any further format ports.
