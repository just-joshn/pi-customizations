# reverse-engineer-anything behavioral specification

The capability under port is REA's agent-facing investigation contract: an
evidence envelope every operation returns, a vocabulary that keeps observations,
inferences and unknowns separate, a session ledger that makes conclusions
re-checkable, and the engine-free analyzers that answer questions about shipped
artifacts. The port is a Pi skill that reaches the same contract with local
Node-only tooling and no REA dependency.

## Sources

| Ref | Kind | Location | License or authorization |
| --- | --- | --- | --- |
| `REA-README` | permitted source (public docs) | https://github.com/morluto/rea `README.md` (cloned @ 2026-10-13) | MIT, © 2026 morluto |
| `REA-DOCS` | permitted source (public docs) | `docs/*.md` in the same clone, in particular `docs/mcp-contracts.md`, `docs/error-contract.schema.json`, `docs/mcp-prompts.md`, `docs/javascript-application-workflows.md` | MIT |
| `REA-SKILL` | permitted source (published skill, MIT) | `.agents/skills/reverse-engineer-anything/SKILL.md` + `references/*.md`, skill version 41 | MIT. The port cites it; no prose is copied. |
| `REA-CLI` | measured observation | `npx -y rea-agents@6.4.0` on macOS 15 / Node 24.21.0, captured 2026-10-13 | Local read-only analysis of MIT software |
| `REA-MCP` | measured observation | `tools/list` + `prompts/list` over stdio (`scripts/probe-mcp.mjs`), 170 tools, 6 prompts | MIT |
| `FIXTURE` | fixture | `fixtures/` in this directory | Synthetic; see `fixtures/reference/PROVENANCE.md` |

Facts below are labelled **documented** (docs), **observed** (measured on the
reference), **inference**, or **unknown**.

## Scope

### In scope

1. **The Evidence contract.** The envelope, the observation model, the authority
   and coverage vocabularies, and the error contract — the parts of REA every
   operation shares and every conclusion cites. (`ENV-*`, `OBS-*`, `ERR-*`)
2. **Session memory.** Retained evidence with stable content-addressed IDs,
   summary/section/item views, paging, export/import, and the residual-unknown
   registry with immutable revisions. (`STORE-*`, `VIEW-*`, `UNK-*`)
3. **Routing and availability.** Turning a user's target plus question into one
   route, refusing to guess an ambiguous target, and reporting which operations
   this host can actually run, with reasons and remediation. (`CAP-*`, `ROUTE-*`)
4. **Engine-free analyzers** that need no third-party analysis engine, no
   network, and no target execution:
   - extracted JavaScript / Electron trees and ASARs (`JS-*`)
   - archive and package inventories (`ART-*`)
   - binary file and linked layout for Mach-O, ELF and PE (`BIN-*`)
   - Go build metadata (`GO-*`)
   - retained HAR network captures (`HAR-*`)
5. **The investigator's discipline** — the rules REA's skill enforces on the
   agent: observations are not inferences, static analysis never witnessed
   execution, partial coverage never proves absence, and runtime requests are
   bounded by what the user declared. (`DISC-*`)
6. **The Pi skill layer** that routes a user's request into the above, loads
   only the relevant reference, and is discoverable through `pi install .`.
   (`SKILL-*`)

### Out of scope (surrounding harness)

- Provider-backed native decompilation (`open_binary`, `analyze_function`,
  `procedure_pseudo_code`, Hopper/Ghidra/IDA). No provider exists on the port's
  host and the port must not pretend one does. Requirements carry status
  `NOT APPLICABLE` with the installed-host reason.
- Android analysis (JADX/apktool), JEB, ADB device work, firmware extraction
  (Binwalk/Unblob), packet and signal recordings (TShark/sigrok), recorded
  crashes (pwntools), and managed .NET decompilation: same reason.
- Runtime capture of processes, native UI, browser scenarios, and Frida
  instrumentation. These execute or observe live targets; the port keeps the
  discipline requirements that govern them (`DISC-*`) without implementing the
  capture engines.
- The `compare_*`, `project_*`, and reconstruction-ledger families. The port
  keeps the evidence discipline that makes them meaningful and states the gap.
- REA's own distribution: MCP registration, `setup`, `doctor`, provider
  installation, and the npm package.

### Source-internal dependencies and their Pi replacements

| Source dependency | Port replacement |
| --- | --- |
| MCP server (`npx rea-agents mcp`) | `scripts/rea.mjs`, a Node-only CLI with the same operation names |
| MCP transport truncation + `inspect_analysis_view` | Session store: evidence is written to disk first, views read it back |
| REA session ledger | `--store` directory with `ledger.json` + `evidence/<evidence_id>.json` |
| Hopper/Ghidra/IDA providers | none; `capabilities` reports absence with reason and remediation |
| Hopper/Ghidra-backed binary layout | `inspect-binary-layout`, an in-process Mach-O/ELF/PE reader |
| pwntools ELF profile (Linux x64 only) | same operation, macOS-first and multi-format; deviation recorded in `decisions.md` |
| WABT / JADX / TShark / Binwalk | none; declared unavailable rather than approximated |

## Requirements

Requirement IDs are stable. `status` lives in `ledger.json`; `Acceptance test`
here names the intended test, and the ledger owns whether it passes.

### ENV: the Evidence envelope

#### ENV-001: Envelope shape
- Trigger: any analysis command that produces a finding.
- Input → expected output: the operation's arguments produce one JSON object with
  the reference envelope's keys (the fixture's `_fixture_annotations` key is capture
  metadata added when the fixture was frozen, not part of the envelope), with
  the keys `evidence_id`, `subject`, `provider`, `analysis_profile`, `predicate_type`,
  `operation`, `parameters`, `raw_result`, `normalized_result`, `confidence`,
  `authority`, `environment`, `limitations`, `locations`, `evidence_links` — the
  exact key set of the reference envelope (`FIXTURE` `rea-6.4.0-analyze-javascript-application.json`).
- Evidence: `REA-CLI` (`analyze-javascript-application`), **observed**, high.
- Acceptance test: `skills/reverse-engineer-anything/tests/envelope.test.mjs::envelope carries the reference key set`

#### ENV-002: Subject identity
- Trigger: every operation that inspects a local artifact.
- Input → expected output: `subject.name`, `subject.digest.sha256`,
  `subject.format`, `subject.architecture`, `subject.local_path`. The digest is
  the SHA-256 of the bytes actually read; a directory subject digests the
  canonical tree (paths, modes, bytes), not the path string.
- Evidence: `REA-CLI`; **observed**; high for files, **inference** for the
  directory tree definition (the reference does not publish its tree digest).
- Acceptance test: `tests/envelope.test.mjs::subject digest is content-addressed and stable across paths`

#### ENV-003: Content-addressed evidence identity
- Trigger: the same input analyzed twice.
- Input → expected output: the same `evidence_id` for the same
  `(operation, parameters, subject digest, normalized result)`; a changed input
  changes the ID. The literal REA hash is not reproducible, so the port
  guarantees stability and collision behaviour rather than byte equality.
- Evidence: `REA-MCP` (`evidence_id` is `ev_` + 64 hex); **observed** for shape,
  **unknown** for the reference's exact preimage.
- Acceptance test: `tests/envelope.test.mjs::evidence ids are deterministic and input-sensitive`

#### ENV-004: Provider and predicate identity
- Trigger: every operation.
- Input → expected output: `provider` = `{id, name, version}` naming the local
  implementation of the operation, `predicate_type` = the operation's stable
  predicate string, `operation` = the snake_case operation name matching the
  reference catalog where the port implements the same behavior.
- Evidence: `REA-CLI`; **observed**.
- Acceptance test: `tests/envelope.test.mjs::provider and predicate identify the operation`

#### ENV-005: Confidence, authority, environment, locations
- Trigger: every operation.
- Input → expected output: `confidence` is one of the reference values
  (`derived`, `observed`, `inferred`, `unknown`); `authority` names the evidence
  authority (`shipped-artifact`, `static-relationship-inference`, …);
  `environment` is null unless runtime evidence exists; `locations` is a
  non-empty array of artifact paths or source ranges; `evidence_links` is an
  array of related evidence IDs.
- Evidence: `REA-CLI`; **observed**, high.
- Acceptance test: `tests/envelope.test.mjs::confidence and authority use the reference vocabularies`

#### ENV-006: Limitations travel with results
- Trigger: any result whose coverage is partial.
- Input → expected output: `limitations` is a non-empty array of sentences that
  state what was not established; a limitation is never dropped when a result is
  viewed or exported.
- Evidence: `REA-CLI`; **observed**, high.
- Acceptance test: `tests/envelope.test.mjs::limitations survive view and export`

### OBS: the observation model

#### OBS-001: Observations carry their own evidence
- Trigger: graph-producing operations (`JS-*`, `ART-*`, `BIN-*`).
- Input → expected output: each observation has `label`, `properties`,
  `evidence` with `authority`, `state`, `confidence`, `artifact`, `location`,
  `extractor`, `coverage`, `limitations`, `evidence_ids`, plus `observation_id`
  and `identifier_strategy`.
- Evidence: `FIXTURE`; **observed**, high.
- Acceptance test: `tests/graph.test.mjs::observations carry artifact, location, extractor and coverage`

#### OBS-002: State vocabulary separates observation from inference
- Trigger: any observation.
- Input → expected output: `state` is `observed`, `inferred`, or `unknown`. A
  *fact* the analyzer read directly — file bytes (`artifact-bytes`) or syntax
  present in a file (`ast-static-analysis`) — is `observed`; a *relationship it
  reasoned about*, such as a resolved process role or an unresolved specifier
  (`static-relationship-inference`), is `inferred`. No static operation may ever
  produce an observation about execution, so `observed` never means "ran"
  outside a record whose operation executed the declared target.
- Evidence: `REA-SKILL` ("never imply that static analysis observed execution"),
  `REA-CLI` (`state: "inferred"`, `authority: "static-relationship-inference"`);
  **documented** + **observed**, high.
- Acceptance test: `tests/graph.test.mjs::static syntax yields inferred observations`

#### OBS-003: Coverage is explicit and never silently complete
- Trigger: analysis that can stop early (size, timeout, parse failure, page limit).
- Input → expected output: `coverage` = `{status, truncated, omitted_count, limits}`
  with `status` in `complete`, `partial`, `unavailable`; `truncated: true`
  requires a numeric `omitted_count`; `limits` explains each reduction.
- Evidence: `FIXTURE` (`status: "partial"` with `omitted_count: null`);
  **observed**, high.
- Acceptance test: `tests/graph.test.mjs::truncated coverage reports an omitted count`

#### OBS-004: A missing match in partial input is not absence
- Trigger: a search that finds nothing while coverage is partial.
- Input → expected output: the result reports the search as bounded and
  unresolved rather than negative; the CLI prints the boundary and the port
  records an unknown when the question matters.
- Evidence: `REA-SKILL`, `REA-DOCS` (`docs/javascript-application-graph.md`);
  **documented**, high.
- Acceptance test: `tests/discipline.test.mjs::partial coverage blocks an absence claim`

### ERR: the error contract

#### ERR-001: Error envelope
- Trigger: invalid input, unsupported target, unavailable capability, integrity
  mismatch, timeout, cancellation, resource constraint, execution failure.
- Input → expected output: JSON on stdout with `code`, `category`, `message`,
  `retryable`, `remediation.action`, and `details`; `category` is one of the ten
  reference categories; process exit code is 1.
- Evidence: `REA-DOCS` (`docs/error-contract.schema.json`), `REA-CLI` (two
  captured failures); **documented** + **observed**, high.
- Acceptance test: `tests/errors.test.mjs::error envelopes match the reference schema`

#### ERR-002: Remediation is actionable
- Trigger: every error.
- Input → expected output: `remediation.action` names the next step; for
  `capability_unavailable` it says why the operation cannot run here and what
  would make it possible.
- Evidence: `REA-CLI`; **observed**, high.
- Acceptance test: `tests/errors.test.mjs::remediation names the next step`

#### ERR-003: Invalid input enumerates the issues
- Trigger: a malformed argument or a missing target path.
- Input → expected output: `code: invalid_request`, `category: invalid_input`,
  `retryable: true`, `details.issues[]` with `path`, `reason`, `message`.
- Evidence: `REA-CLI` (`rea-6.4.0-errors.json` case 2); **observed**, high.
- Acceptance test: `tests/errors.test.mjs::invalid input lists every issue path`

#### ERR-004: Unavailable capability is not a crash
- Trigger: an operation whose host prerequisite is absent.
- Input → expected output: `code: capability_unavailable`, `category:
  unsupported_provider`, `retryable: false`, `details` naming the operation and
  the missing prerequisite; no partial result is emitted as if complete.
- Evidence: `REA-CLI` (`rea-6.4.0-errors.json` case 1); **observed**, high.
- Acceptance test: `tests/errors.test.mjs::missing prerequisite yields capability_unavailable`

### STORE: session memory

#### STORE-001: Evidence is durable before it is reported
- Trigger: every analysis command.
- Input → expected output: the evidence JSON is written to
  `<store>/sessions/<session>/evidence/<evidence_id>.json` before stdout is
  written, with a temp-file-plus-rename write, and indexed in `ledger.json`.
- Evidence: `REA-SKILL` ("Retained HAR… Evidence stays retained"), **documented**;
  the durability mechanism is the port's design.
- Acceptance test: `tests/store.test.mjs::evidence lands on disk before reporting`

#### STORE-002: Retained evidence is deduplicated
- Trigger: the same operation on the same input run twice in one session.
- Input → expected output: one artifact file, one ledger entry, and a
  `repeat_count`; the port does not grow the store or re-analyze silently.
- Evidence: `REA-SKILL` ("do not repeat identical analysis"), **documented**.
- Acceptance test: `tests/store.test.mjs::identical analysis does not duplicate records`

#### STORE-003: Atomic and recoverable writes
- Trigger: an interrupted write, or two writers in one session.
- Input → expected output: no partial JSON is observable; a corrupt record is
  reported rather than silently replaced; `ledger.json` is rewritten atomically.
- Evidence: port design (see `decisions.md`), **inference**.
- Acceptance test: `tests/store.test.mjs::interrupted write leaves the previous record intact`

#### STORE-004: Export and import a bundle
- Trigger: `export-evidence-bundle <path>` / `evidence-import <path>`.
- Input → expected output: one canonical JSON file containing every retained
  record and unknown, byte-stable for the same session, refusing to overwrite
  without `--overwrite`; import rejects a bundle whose records fail digest
  validation.
- Evidence: `REA-MCP` (`export_evidence_bundle`, `get_evidence_bundle`);
  **observed** for the surface, port design for the bytes.
- Acceptance test: `tests/store.test.mjs::bundle export is byte-stable and import validates digests`

### VIEW: reading retained evidence

#### VIEW-001: Summary view without re-analysis
- Trigger: `inspect-analysis-view <evidence_id> --view summary`.
- Input → expected output: a new envelope with `operation:
  inspect_analysis_view`, `predicate_type: rea.analysis-view`,
  `normalized_result.summary` carrying the producer's summary and a `coverage`
  block; the producer is not re-run.
- Evidence: `FIXTURE` (`rea-6.4.0-analysis-view-summary.json`); **observed**, high.
- Acceptance test: `tests/view.test.mjs::summary view reads the retained record`

#### VIEW-002: Item selection by stable node ID
- Trigger: two files with the same path but different graph roles.
- Input → expected output: selecting `--node <node_id>` returns exactly that
  node's observations; the port never selects by path alone when several roles
  share it.
- Evidence: `REA-SKILL` ("a single file path can represent several graph roles");
  **documented**, high.
- Acceptance test: `tests/view.test.mjs::node selection is unambiguous when paths repeat`

#### VIEW-003: Paged sections report exhaustion separately from completeness
- Trigger: a section view over a large graph.
- Input → expected output: pages carry `offset`, `limit`, `returned`,
  `remaining`; page exhaustion is reported apart from `source_complete`, so a
  caller cannot read "no more pages" as "nothing else exists".
- Evidence: `REA-SKILL`; **documented**, high.
- Acceptance test: `tests/view.test.mjs::page counters never imply completeness`

### UNK: residual unknowns

#### UNK-001: Record an unknown
- Trigger: `record-unknown` with a question the current evidence cannot answer.
- Input → expected output: an unknown with a stable `unknown_id`, `question`,
  `severity`, `domain`, required authority/confidence/environment,
  recommended probes, supporting and contradicting evidence IDs, `status:
  unresolved`, `revision: 1`; duplicate questions are rejected with
  `revision_conflict`-style diagnostics rather than duplicated.
- Evidence: `REA-MCP` (`record_unknown`); **observed** for the field set.
- Acceptance test: `tests/unknowns.test.mjs::recorded unknown carries requirements and revision 1`

#### UNK-002: Updates are revision-checked
- Trigger: two updates from the same stale revision.
- Input → expected output: the first appends `revision: 2`; the second fails
  with `revision_conflict` and the reader is told to re-read instead of retrying
  blindly.
- Evidence: `REA-SKILL`, `REA-MCP`; **documented** + **observed**, high.
- Acceptance test: `tests/unknowns.test.mjs::stale revision conflicts instead of overwriting`

#### UNK-003: Resolution needs qualifying evidence
- Trigger: `update-unknown --status resolved`.
- Input → expected output: accepted only when the cited evidence satisfies the
  unknown's required authority and confidence; otherwise rejected with the
  unmet requirement named. Unresolved heads survive in an audit listing ordered
  by ID.
- Evidence: `REA-SKILL` ("Only qualifying observed evidence can verify a
  resolution"), `REA-MCP` (`verify_unknown_resolution`); **documented**, high.
- Acceptance test: `tests/unknowns.test.mjs::resolution is refused without qualifying evidence`

### CAP: what this host can do

#### CAP-001: Availability matrix
- Trigger: `capabilities --json`.
- Input → expected output: every implemented operation with `operation`,
  `available`, `reason`, `availability_code`, `effects`, `limitations`, where
  `effects` carries the seven reference flags (`mutates_artifact`,
  `launches_process`, `may_show_ui`, `may_access_network`, `may_write_filesystem`,
  `changes_permissions`, `requires_root`).
- Evidence: `REA-CLI` (`rea-6.4.0-capabilities.json`); **observed**, high.
- Acceptance test: `tests/capabilities.test.mjs::matrix reports effects for every operation`

#### CAP-002: Availability reflects the installed host
- Trigger: an operation whose prerequisite is missing (for example a HAR
  inspection where the file is absent, or any provider-backed operation).
- Input → expected output: `available: false`, a machine-readable
  `availability_code`, a `reason` naming the missing prerequisite, and
  remediation; the operation then refuses with `capability_unavailable` rather
  than approximating.
- Evidence: `REA-CLI`; **observed**, high.
- Acceptance test: `tests/capabilities.test.mjs::missing prerequisite shows as unavailable with remediation`

#### CAP-003: Effects are not downplayed
- Trigger: any operation that writes files (`STORE-*`), spawns a process, or
  touches the network.
- Input → expected output: the corresponding effect flag is true. The port
  declares no operation that mutates the analyzed artifact.
- Evidence: `REA-CLI`; **observed**, high.
- Acceptance test: `tests/capabilities.test.mjs::write and process effects are declared`

### ROUTE: choosing the route

#### ROUTE-001: One route from the supplied target
- Trigger: a request naming a target.
- Input → expected output: the first operation is chosen from the target alone:
  `.asar`/extracted JS tree → `analyze-javascript-application`; archive/package
  (`zip`, `apk`, `ipa`, `msix`, `appx`, `dmg`) → `inspect-artifact`; Mach-O/ELF/PE
  binary → `inspect-binary-layout`; Go binary → `inspect-go-binary`; `.har` →
  `inspect-web-network-capture`; unknown → an explicit unsupported answer.
- Evidence: `REA-SKILL` ("Route the target first"); **documented**, high.
- Acceptance test: `tests/route.test.mjs::each reference target class routes to its operation`

#### ROUTE-002: Ambiguity asks instead of guessing
- Trigger: "my app", or several installed artifacts matching one name.
- Input → expected output: the port asks which target and returns
  `code: invalid_request`, `category: invalid_input` with the candidate list; it
  never picks an example application on the user's behalf.
- Evidence: `REA-SKILL`; **documented**, high.
- Acceptance test: `tests/route.test.mjs::ambiguous target asks instead of choosing`

#### ROUTE-003: Routing by content, not extension
- Trigger: a target whose extension lies (`.bin` that is a Mach-O, `.zip` that is
  an ELF, extensionless ASAR).
- Input → expected output: the route follows the leading bytes; a mismatch is
  reported as an integrity observation rather than silently retargeted.
- Evidence: `REA-CLI` (`--artifact-format auto`); **observed**, medium.
- Acceptance test: `tests/route.test.mjs::content beats extension and mismatches are reported`

### JS: JavaScript and Electron applications

#### JS-001: Analysis without execution
- Trigger: `analyze-javascript-application <path>` on an extracted tree or ASAR.
- Input → expected output: an envelope whose `normalized_result` carries
  `input_path`, `format`, `root_artifact_sha256`, `inventory_manifest_id`,
  `integrity_contradictions`, `graph`, `summary`, `statistics`, `limitations`;
  no file from the target is executed, imported, or evaluated.
- Evidence: `FIXTURE` (`rea-6.4.0-analyze-javascript-application.json`); **observed**, high.
- Acceptance test: `tests/javascript.test.mjs::analyzing a tree executes nothing`

#### JS-002: Module resolution and external requests
- Trigger: `require`/`import` of a local file, a package, or an Electron module.
- Input → expected output: `javascript-module` nodes with
  `declared_specifier`, `resolution_status` (`resolved`, `external`, `unresolved`),
  and `imports` edges carrying specifier, imported name, local name and
  resolution status.
- Evidence: `FIXTURE` (`javascript-module` observation properties); **observed**, high.
- Acceptance test: `tests/javascript.test.mjs::inside, outside and unresolved specifiers are distinguished`

#### JS-003: Electron process roles
- Trigger: an Electron app with a main entry, preload and renderer.
- Input → expected output: `electron-main`, `electron-renderer`, `browser-window`,
  `context-bridge-api`, `ipc-handler`, `ipc-channel` and `native-export` nodes
  where the syntax supports them, each with a `mechanism` and a resolution
  status; a declared path that does not exist is reported unresolved, not assumed.
- Evidence: `FIXTURE` (node kinds, `electron-renderer` properties); **observed**, high.
- Acceptance test: `tests/javascript.test.mjs::electron roles and unresolved preload are reported`

#### JS-004: IPC pairing summary
- Trigger: a renderer `invoke`/`send` and a main `handle`/`on` using the same
  literal channel.
- Input → expected output: `summary.ipc` counts operations, literal channels,
  dynamic channel operations, renderer transmissions, renderer listeners, main
  handlers, paired transmissions and unpaired literal transmissions.
- Evidence: `FIXTURE` (`summary.ipc`); **observed**, high.
- Acceptance test: `tests/javascript.test.mjs::paired and unpaired channels are counted`

#### JS-005: Context bridge exposure
- Trigger: `contextBridge.exposeInMainWorld(name, {…})` in a preload script.
- Input → expected output: a `context-bridge-api` node with `world`, `api_key`,
  member names, and an unknown-member count when members are computed.
- Evidence: `FIXTURE`; **observed**, high.
- Acceptance test: `tests/javascript.test.mjs::exposed members and unknown members are separated`

#### JS-006: Native add-on requests are requests, not exports
- Trigger: `require('./x.node')` or a package with a native binding.
- Input → expected output: `native-addon` and `native-export` observations with
  `native_export_verification` stating that requested member names are not
  verified binary exports.
- Evidence: `FIXTURE`; **observed**, high.
- Acceptance test: `tests/javascript.test.mjs::native member names are marked unverified`

#### JS-007: Statistics and parse failures
- Trigger: files that are not valid JavaScript or that fail to parse.
- Input → expected output: `statistics` with `relevant_files`,
  `parsed_javascript_files`, `visited_ast_nodes`, `findings`, `parse_failures`,
  and a `javascript-asset` observation per file reporting its parse status; one
  unparsable file does not abort the analysis.
- Evidence: `FIXTURE` (`statistics`); **observed**, high.
- Acceptance test: `tests/javascript.test.mjs::parse failure is recorded and does not abort`

#### JS-008: ASAR and directory formats
- Trigger: a directory, an ASAR, or a nested ASAR inside an archive.
- Input → expected output: `format` reports `directory` or `asar`; an ASAR is
  read from its own member index without bulk extraction; integrity
  contradictions (declared size/offset vs actual) are listed in
  `integrity_contradictions` and, under the default `fail` policy, abort with
  `artifact_integrity_mismatch`.
- Evidence: `REA-DOCS`, `REA-CLI` (`--artifact-format`, `--integrity-policy`);
  **documented** + **observed**, high.
- Acceptance test: `tests/javascript.test.mjs::asar inventory honours the integrity policy`

#### JS-009: A hostile input cannot escape the target
- Trigger: an archive member named `../../etc/passwd`, an absolute member path, a
  symlink member, or a very large declared size.
- Input → expected output: members are read in-memory by logical path only; the
  port never writes a member to disk during analysis, and a member path that
  escapes the archive root is reported as an integrity observation.
- Evidence: port design (see `security.md` in the harness), **inference**.
- Acceptance test: `tests/javascript.test.mjs::escaping member paths are refused`

### ART: archive and package inventory

#### ART-001: Complete inventory in one call
- Trigger: `inspect-artifact <path>` on a zip-family archive.
- Input → expected output: a content-addressed inventory with an occurrence per
  member (`logical_path`, `bytes`, declared and calculated SHA-256, unpacked
  flag), node/edge collections, and root observations; inspection does not
  extract members to disk.
- Evidence: `REA-MCP` (`inspect_artifact`, `inspect_analysis_view` inventory
  collections), `REA-DOCS`; **observed** + **documented**, high.
- Acceptance test: `tests/artifact.test.mjs::inventory lists every member with digests`

#### ART-002: Integrity contradictions
- Trigger: a member whose declared CRC-32 or size disagrees with its bytes.
- Input → expected output: the contradiction is listed, and under the default
  policy the call fails with `artifact_integrity_mismatch` carrying
  `logical_path`, `declared_sha256`, `calculated_sha256`, `unpacked`; under
  `record-and-continue` the inventory is returned with the contradiction recorded.
- Evidence: `REA-DOCS` (`docs/error-contract.schema.json`); **documented**, high.
- Acceptance test: `tests/artifact.test.mjs::integrity policy decides the outcome`

#### ART-003: Inventory paging
- Trigger: an archive with more members than one page.
- Input → expected output: `inspect-analysis-view --view inventory --collection
  occurrences --logical-paths <p1,p2>` returns the selected occurrences and
  reports page counters separately from source completeness.
- Evidence: `REA-MCP`; **observed**, high.
- Acceptance test: `tests/artifact.test.mjs::occurrence selection pages without implying completeness`

#### ART-004: Unsupported containers are named
- Trigger: a `.dmg`, `.tar.gz`, `.7z`, or a file that is not an archive.
- Input → expected output: an explicit `unsupported_target` or
  `capability_unavailable` error naming the detected format; the port never
  guesses an inventory from file names.
- Evidence: `REA-CLI` (DMG/PKG limitations in capabilities); **observed**, high.
- Acceptance test: `tests/artifact.test.mjs::unsupported containers are named, not guessed`

### BIN: binary file and linked layout

#### BIN-001: Format and architecture facts
- Trigger: `inspect-binary-layout <path>` on a Mach-O, ELF, or PE file.
- Input → expected output: `format`, `architecture`, `endianness`, `bits`,
  bitexact `sha256`, and per-file-type structure (Mach-O load commands and
  fat slices; ELF program/section headers; PE optional header and sections).
- Evidence: `REA-CLI` (operation exists), `REA-DOCS` (`docs/binary-diagnostics.md`);
  **documented** for the surface; the reader is the port's own, `decisions.md`.
- Acceptance test: `tests/binary.test.mjs::mach-o, elf and pe facts are read from bytes`

#### BIN-002: Symbols, imports and exports
- Trigger: a binary with symbol or import tables.
- Input → expected output: imported and exported symbols with their source table,
  and a `coverage` block; a stripped binary reports an empty table as
  `unavailable` coverage rather than as "no imports".
- Evidence: `REA-DOCS`; **documented**, high.
- Acceptance test: `tests/binary.test.mjs::a stripped binary reports unavailable symbol coverage`

#### BIN-003: Static mitigation candidates
- Trigger: ELF with NX, PIE, RELRO, stack canary, or FORTIFY markers.
- Input → expected output: each mitigation is a candidate with the observation
  that produced it, labelled as an inference from static markers.
- Evidence: `REA-README` (static mitigation candidates); **documented**, medium.
- Acceptance test: `tests/binary.test.mjs::mitigations cite their marker`

#### BIN-004: The reference's platform boundary is not inherited
- Trigger: an ELF inspected on macOS.
- Input → expected output: the port reads it (the reference refuses anything but
  Linux x64 through pwntools) and records the deviation in its own limitations.
- Evidence: `REA-CLI` (captured `capability_unavailable` on macOS), **observed**, high.
- Acceptance test: `tests/binary.test.mjs::elf on darwin is read with an explicit deviation limitation`

#### BIN-005: Malformed input fails closed
- Trigger: a truncated header, an absurd load-command count, or a section offset
  past the end of the file.
- Input → expected output: `code: unsupported_target` or `execution_failure` with
  the offending offset; no reader reads past the buffer, and no crash.
- Evidence: port design, **inference**.
- Acceptance test: `tests/binary.test.mjs::truncated and out-of-range structures fail closed`

### GO: Go build metadata

#### GO-001: Compiler and module facts
- Trigger: `inspect-go-binary <path>` on a Go binary.
- Input → expected output: Go version, build settings, the module list with
  versions and replacements, and the raw byte ranges they came from.
- Evidence: `REA-README` (Go binaries row); **documented**, high.
- Acceptance test: `tests/go.test.mjs::buildinfo yields version, settings and modules`

#### GO-002: Absent metadata is not proof of absence
- Trigger: a non-Go binary, or a Go binary with stripped buildinfo.
- Input → expected output: `capability_unavailable` or a result whose coverage is
  `unavailable` with the searched ranges named; the port never concludes "not Go".
- Evidence: `REA-README` ("absent metadata does not prove a binary is not Go");
  **documented**, high.
- Acceptance test: `tests/go.test.mjs::missing buildinfo is reported as unknown`

### HAR: retained network captures

#### HAR-001: Offline inspection only
- Trigger: `inspect-web-network-capture <path.har>`.
- Input → expected output: requests and responses with method, URL (query values
  preserved, userinfo credentials removed), status, headers, body sizes and
  payloads where recorded; the port never fetches a recorded URL.
- Evidence: `REA-DOCS` (`docs/web-network-captures.md`), `REA-SKILL`; **documented**, high.
- Acceptance test: `tests/har.test.mjs::inspection performs no network access`

#### HAR-002: Credential and payload exclusions
- Trigger: a capture containing `Authorization`, `Cookie`, `Set-Cookie`, or a
  WebSocket/JSON body.
- Input → expected output: credential headers are absent from the result while
  their presence is recorded; payloads that the capture recorded are reported as
  recorded observations, not as live traffic.
- Evidence: `REA-DOCS`, `REA-SKILL`; **documented**, high.
- Acceptance test: `tests/har.test.mjs::authorization and cookie values never appear`

#### HAR-003: Interface surface grouping
- Trigger: `inspect-analysis-view --view api-surface` on retained HAR evidence.
- Input → expected output: observed request lines grouped by method, origin and
  path template, each group citing parent record ordinals, with the statement
  that format matches are inferences rather than handler identity.
- Evidence: `REA-DOCS` (`docs/evidence-workflows.md`); **documented**, high.
- Acceptance test: `tests/har.test.mjs::api surface groups by method, origin and path template`

#### HAR-004: Record identity and coverage
- Trigger: a capture with duplicate URLs, paged records, or an unsupported HAR
  version.
- Input → expected output: records keep their original ordinal, pages cite
  ordinals rather than positions, and an unsupported version is refused with an
  explicit error.
- Evidence: `REA-SKILL`; **documented**, medium.
- Acceptance test: `tests/har.test.mjs::record ordinals survive paging`

### DISC: investigator discipline

#### DISC-001: Observations, inferences and unknowns stay separate
- Trigger: every report the skill produces.
- Input → expected output: each finding names its evidence ID and its kind; a
  conclusion with no supporting evidence ID is presented as an open question,
  and the unknown registry holds it.
- Evidence: `REA-SKILL`; **documented**, high.
- Acceptance test: `tests/discipline.test.mjs::a finding without evidence cannot be reported as observed`

#### DISC-002: Static analysis never claims execution
- Trigger: any statement about runtime behavior based on an artifact.
- Input → expected output: the summary states the analysis was inert and that
  runtime behavior is unproven; a claim of execution requires a runtime
  operation whose declared target matches the analyzed artifact.
- Evidence: `REA-SKILL`; **documented**, high.
- Acceptance test: `tests/discipline.test.mjs::execution claims require a runtime record`

#### DISC-003: The analysis is reproducible from the record
- Trigger: a later reader opening the exported bundle.
- Input → expected output: every cited evidence ID resolves in the bundle, every
  unresolved question appears in the unknown audit, and no conclusion cites an
  ID that is absent.
- Evidence: `REA-SKILL`; **documented**, high.
- Acceptance test: `tests/discipline.test.mjs::bundle resolves every cited evidence id`

#### DISC-004: The port never widens the declared target
- Trigger: a request scoped to one artifact.
- Input → expected output: no operation reads, executes, or contacts anything
  outside that artifact's bytes and the store; path arguments are resolved and
  confined to the declared target.
- Evidence: `REA-SKILL` ("do not broaden the target"); **documented**, high.
- Acceptance test: `tests/discipline.test.mjs::paths outside the target are refused`

### SKILL: the Pi skill layer

#### SKILL-001: Discovery and activation
- Trigger: `pi install .` from the repository root, then a session.
- Input → expected output: Pi lists `reverse-engineer-anything` with its
  description, `/skill:reverse-engineer-anything <target>` loads it, and the
  frontmatter passes Pi's own validator.
- Evidence: `REA-SKILL` (install path `~/.agents/skills/`); **observed**;
  target mechanism per Pi `docs/skills.md`.
- Acceptance test: `tests/skill.test.mjs::skill frontmatter is valid and the skill loads in Pi`

#### SKILL-002: Routing instructions match the implementation
- Trigger: every command named in `SKILL.md` and its references.
- Input → expected output: each documented command exists in
  `scripts/rea.mjs`, each documented flag is accepted, and no reference names an
  operation the port does not implement.
- Evidence: port design; **inference**.
- Acceptance test: `tests/skill.test.mjs::every documented command exists and accepts its documented flags`

#### SKILL-003: Loading stays cheap
- Trigger: a session that never mentions reverse engineering.
- Input → expected output: only the name, description, and path are in the system
  prompt; the body and references load on demand.
- Evidence: Pi `docs/skills.md`; **documented**, high.
- Acceptance test: `tests/skill.test.mjs::description is the only always-loaded text`

## Out-of-scope requirements

Requirements the port deliberately does not implement are encoded in
`ledger.json` with `status: "NOT APPLICABLE"` and a `reason`, so the boundary is
machine-checkable: provider decompilation (`open_binary`, `analyze_function`,
`procedure_*`, `decompile`, `trace_feature`, native annotation/bookmarks),
Android/JEB/ADB, firmware, pcap/signals/crashes, managed .NET, process/UI/browser
capture, `compare_*`, `project_*`, reconstruction ledgers, and Frida.

## Unknowns

| Question | Why it matters | How it could be resolved |
| --- | --- | --- |
| How the reference computes `root_artifact_sha256` for a directory tree | The port's tree digest will differ byte-for-byte | Read the reference source, or compare digests over crafted trees |
| The reference's `evidence_id` preimage | Literal ID equality is impossible to claim | Same |
| Whether `inspect_artifact` inventories DMG images on this host | The capability matrix must not claim more than it can do | Run it against a DMG and record the observation |
| How the reference pages a large JavaScript graph | The port's page counters are a design choice meanwhile | Run it on Bruno's `app.asar` (measurement only, contents not committed) |
| Whether any REA analysis writes outside its output path | The port claims no side effects; the reference's were not audited | Trace file effects during a capture run |

## Addenda

Requirements added while implementing, each with its own acceptance test in
`skills/reverse-engineer-anything/tests/`. They extend the numbered sections above.

| ID | Requirement | Acceptance test |
| --- | --- | --- |
| `ART-005` | A hostile member path (absolute, drive-lettered, or containing `..`) is refused and never read | `artifact.test.mjs::ART-005` |
| `ART-006` | A truncated container fails closed with a named code, never a crash | `artifact.test.mjs::ART-006` |
| `BIN-006` | A real host Mach-O binary is read when one is present (skipped otherwise) | `binary.test.mjs::BIN-006` |
| `GO-003` | A real host Go binary yields version, settings and modules (skipped when absent) | `go.test.mjs::GO-003` |
| `GO-004` | A malformed buildinfo blob degrades to partial coverage instead of throwing | `go.test.mjs::GO-004` |
| `HAR-005` | A capture larger than the member cap reports `truncated` with an exact `omitted_count` | `har.test.mjs::HAR-005` |
| `ROUTE-004` | A binary carrying the Go buildinfo marker routes to `inspect-go-binary`, with `inspect-binary-layout` retained as the alternative | `route.test.mjs::ROUTE-004` |
| `STORE-005` | A bundle export refuses to overwrite an existing file unless asked | `store.test.mjs::STORE-005` |
| `STORE-006` | A view refuses to read a directory as evidence | `store.test.mjs::STORE-006` |
| `VIEW-004` | An unknown view kind, a missing selector, and an unmatched selector are refused with issue paths | `view.test.mjs::VIEW-004` |
| `UNK-004` | An unknown survives an export/import round trip | `unknowns.test.mjs::UNK-004` |
| `JS-010` | The CLI returns a reference-shaped envelope and the same evidence ID for the same input | `javascript.test.mjs::JS CLI` |
| `DISC-005` | Absence may only be claimed inside complete coverage | `discipline.test.mjs::DISC-005` |
| `DISC-006` | The port's own analyzer output passes the discipline audit | `discipline.test.mjs::DISC-006` |
| `CAP-004` | Concurrent writers lose no ledger index entry | `store.test.mjs::STORE-003b` |
| `INDEP-001` | No shipped file names the upstream package, CLI, MCP surface or any unimplemented command | `skill.test.mjs::INDEP-001` |
| `INDEP-002` | No shipped module can import a network or process module, and none calls `fetch` | `skill.test.mjs::INDEP-002` |
| `INDEP-003` | Production code never reads the development evidence tree under `parity/` | `skill.test.mjs::INDEP-003` |
| `SEC-001` | A ZIP member over the 256 MiB limit is refused before decompression | `artifact.test.mjs::ART-007` |
| `SEC-002` | A hostile bundle or CLI argument cannot name a path outside the store | `store.test.mjs::STORE-007`, `store.test.mjs::STORE-008` |
| `SEC-003` | Concurrent unknown updates cannot both append the same revision | `store.test.mjs::STORE-009` |
| `SEC-004` | Credential query values and signing headers never survive a capture inspection | `har.test.mjs::HAR-006` |
| `SEC-005` | Pathological nesting degrades with a named error instead of a stack overflow | `envelope.test.mjs::ENV-007`, `javascript.test.mjs::JS-011` |
| `SEC-006` | A held lock is not stolen from a live writer | `store.test.mjs::STORE-010` |
| `ARCH-001` | The discipline audit is reachable from the CLI | `discipline.test.mjs::DISC-007` |
| `ARCH-002` | A view reads evidence through the validated reader | `route.test.mjs::ROUTE-006` |
| `ARCH-003` | A flag is boolean only where the command declares it | `route.test.mjs::ROUTE-007` |
| `ARCH-004` | A malformed capture is a typed target error, not an execution failure | `har.test.mjs::HAR-007` |
| `MACOS-001` | Apple metadata families (plist, keyed archive, asset catalog, interface builder, signature) are refused by name with a reason | `capabilities.test.mjs::CAP-001` |
| `MACOS-002` | Provider- and toolchain-backed native families (dylib tracing, dispatch metadata, managed/native boundaries, artifact extraction) are refused by name with a reason | `capabilities.test.mjs::CAP-002` |
| `SKILL-005` | The skill loads in a real Pi session and the agent uses the port's CLI | `fixtures/e2e/pi-skill-load.txt` |
| `SKILL-006` | `pi install` of the repository root exposes the skill in an isolated agent directory, and removal unregisters it | `fixtures/e2e/pi-install-cycle.txt` |

## Platform boundary

The reference's provider tier is unavailable on this host: `rea inspect-binary-layout` on
macOS returns `capability_unavailable` ("the initial real-verified pwntools artifact profile
supports Linux x64 only"), and no Hopper/Ghidra/IDA/JADX/TShark/Binwalk is installed. The port
therefore *replaces* the pwntools surface with its own multi-format reader and records every
provider-backed family as out of scope in `ledger.json`, rather than approximating it.
