# pi-rea ↔ rea-agents 6.8.0 differential ledger

Frozen harness: `bun parity/pi-rea/scripts/run-differential.mjs` (optional `CASE=`).
Allowlists live in `evidence/differential/mismatches.json`. No blanket `normalized_result.*`.

## What this proves

The DiffCase table is a **host-conditioned envelope smoke** against measured `npx` `rea-agents` 6.8.0 on this Darwin machine. It is not a claim that every REA code path is reimplemented, that every tool of the 229-name catalog has a DiffCase, or that refuse prose is live-probed on every host.

Normalize still scrubs volatile digests and graph ids. Exact means the remaining normalized payload matches the oracle for that case.

## VERIFIED exact (measured diff_count=0)

**108 exact / 0 documented / 108 total**, measured 2026-10-28. The same harness before this pass measured **93 exact / 0 documented / 93 total**, which is exactly what this ledger recorded at hillclimb r23, so no recorded case drifted. All 93 of those cases still pass unchanged in the 108-case run. The 15 added cases are the session kernel and PE import cases below.

All DiffCases are exact vs measured `npx` `rea-agents` 6.8.0 envelopes on this Darwin host, including:

- `analyze_javascript_application--notepad` — field-envelope densify (was ~287 documented residual; now exact).
- `compare_application_versions--js-compare` / export-shape / source-to-bundle — packaging plus change-graph exact.
- Frida `start_frida_session--missing` / `list_frida_devices--missing` — harness-aligned refuse prose (attach pid miss / `NODE_OPTIONS=--no-addons`). Production refuse text follows those measured envelopes rather than re-probing Frida or PATH on every call.
- Oracle-refuse fixtures (`inspect_rust_binary`, `inspect_il2cpp_metadata`, `inspect_dart_aot`, `inspect_asset_catalog`, `export_web_scripts`, Darwin pwntools `inspect_binary_layout` / `inspect_recorded_crash`) — match measured refuse kinds/codes/prose.
- `inspect_with_objdump--gap` / `inspect_native_exports--gap` — host objdump / in-process ELF export Evidence matching measured shapes.

### Session kernel cases (added)

- `open_binary--minimal-elf`, `open_binary--missing`, `open_binary--directory`, `open_binary--unsupported-format`, `close_binary--open-then-close`, `close_binary--snapshot-open`, `close_binary--snapshot-closed` — full-envelope exact. Fixes measured against the oracle: the missing-path error uses `access` (REA's `ENOENT ... access '<path>'`), the directory refusal carries REA's `rea analyze <directory>` hint and remediation, an unknown format is `target_unavailable` / `unsupported_target` with `constraint: file_format_rejected`, and `close_binary` checks session state before snapshot semantics (open session → `evidence_integrity_mismatch` with REA's reason; closed session → `target_unavailable` "No app is open...").
- `binary_session--alignment-unknown`, `--alignment-digest-mismatch`, `--alignment-path-mismatch`, `--alignment-version-mismatch` — declared `compare_paths` subset compares of `result.server_identity.alignment` (the default case also compares `result.open`, `result.cleanup_pending` and `result.client_features`). Measured REA behavior: mismatched expectations report `state: mcp_server_restart_required` with `package_version_mismatch` / `catalog_digest_mismatch` / `registration_path_mismatch` and REA's remediation; a matching expectation reports `aligned` / `null`; no expectation reports `unknown` with REA's remediation. pi-rea previously threw `invalid_request` on a mismatch.

### PE import cases (added)

`inspect_pe_imports--budget-dlls`, `--unreadable-name`, `--unmapped-directory`, `--unreadable-thunk`, built by `ensurePeImportFixtures()` under the gitignored `fixtures/targets/pe/imports/`. Fixes measured against the oracle: a descriptor or function budget now scans one entry past the allowance and fails with REA's `resource_constraint` envelope (`reported_limits`, budget-specific remediation, "declares <budget+1>") instead of returning a silently truncated inventory; issue rows carry REA's hex-RVA locations and messages (`Import descriptor DLL name: ...`, `Import descriptor: ...`, `Virtual address or string range is not file mapped`); an import with an unreadable name is dropped; coverage becomes `partial` with REA's "N import table issue(s)..." reason; the imphash is withheld with REA's incomplete-table reason; `max_dlls` / `max_functions` are capped at REA's runtime limits (4096 / 262144).

## DOCUMENTED gap (with measured blocker)

None. `mismatches.json` cases map is empty.

## Subset compares

`binary_session` is the only tool whose normalized envelope is compared through `compare_paths`. `result.tool_availability`, `result.capabilities`, `result.analysis_provider_*` and the rest of `result.server_identity` state each server's own measured coverage: pi-rea implements 63 of the 229 catalog tools, and the oracle reports this host's Ghidra/Hopper/IDA/Kuna diagnostics. Comparing those subtrees would measure port scope, not the kernel contract. `diff-summary.json` records `compared_paths` for every case, and the four cases above compare exactly the request-level alignment contract. The frozen-capture test in `test/session-tools.test.ts` (KERN-011) still pins the full `binary_session` shape against `rea-6.8.0-binary_session.json`.

## Analyzer findings proven by oracle-pinned unit tests (not live DiffCases)

Each fix below was measured against `npx -y rea-agents@6.8.0` this session and pinned by a test that asserts the measured JSON. A live DiffCase is not possible yet because the surrounding envelope still differs (residuals listed after the table).

| Finding | Measured REA | pi-rea after fix | Test |
| --- | --- | --- | --- |
| `managed-artifact.ts` unknown PE machine reported as `x86` | Rejects the artifact: `target_unavailable` / `unsupported_target`, "Cannot open artifact: unsupported PE architecture (COFF machine 0x1234).", details `{reason, constraint: file_format_rejected}` | Same envelope; machines outside `{x86, x86_64, arm, arm64}` are refused before inspection | `test/managed-oracle-parity.test.ts`, `test/managed-analyzer-branches.test.ts` |
| `managed-artifact.ts` `module.mvid` always `null` | `Module` row GUID resolved through the `#GUID` heap, lowercase GUID with little-endian first three groups | Reads the GUID index from the `Module` row and formats the same string (`04030201-0605-0807-090a-0b0c0d0e0f10` measured) | `test/managed-oracle-parity.test.ts` |
| `managed-artifact.ts` coverage ignored partial metadata / truncated `#~` | `coverage.state: partial` for a missing `#~` (`missing-stream`) and for a truncated row-count region (`invalid-metadata-root`) | `coverage.state` follows `metadata.status`; a non-complete stream adds `metadata stream is incomplete` | `test/managed-oracle-parity.test.ts` |
| `rust-binary.ts` document-level `root` rejected then read | Accepted document is exactly `{packages, format?}`; `root` at document level is rejected (`Dependency JSON does not match the package schema`); root index comes from `packages[i].root` | Validator rewritten to that schema; the dead `root['root']` read is deleted; unsafe dependency indexes and multiple roots get REA's issue text | `test/analyzer-oracle-parity.test.ts` |
| `macho-signature.ts` zero-length `LC_CODE_SIGNATURE` reported as absent | Any absent or undecodable signature returns `signed: false`, `format: null`, limitations `["Artifact is not signed.", "<snapshot limitation>"]`; no reason strings | Same shape for the zero-length command, past-EOF region, non-SuperBlob region, and no CodeDirectory | `test/analyzer-oracle-parity.test.ts`, `test/apple-analyzer-branches.test.ts` |
| `sqlite-database.ts` `tableKind` returned `unknown` on both arms | Premise is false: SQLite refuses to open a database whose ordinary table has `sqlite_schema.sql = NULL`; REA returns `invalid_format` "malformed database schema" | Dead branch deleted; REA's rejection pinned | `test/analyzer-oracle-parity-b.test.ts` |
| `apk-signature.ts` dropped `uninterpreted_bytes`; zero signers reported signed | Trailing bytes outside the signers sequence are counted per scheme and summed in a prepended limitation; an empty parsed signer list reports `schemes_agree_on_signer: null` | Counts the trailing bytes, prepends REA's wording, treats an empty signer list as unknown agreement | `test/analyzer-oracle-parity-b.test.ts`, `test/mobile-analyzer-branches.test.ts` |
| GGUF / int64 SQLite failures escaped as bare `Error` | GGUF: `target_unavailable` (truncated header), `resource_constraint` (exact-offset overflow), `unsupported_target` (version); corrupt SQLite: `invalid_request` with `invalid_format` issue and empty `captured_output` | Tool boundary maps those envelopes; SQLite reads integers with `setReadBigInts` and returns `9223372036854775807` / `-9223372036854775808` exactly, wrapping other failures in the same envelope | `test/analyzer-oracle-parity-b.test.ts` |
| `devicetree` ignored the session cwd | No oracle surface takes a cwd | Wrapper resolves relative paths against `context.cwd` like peer tools | `test/analyzer-oracle-parity-b.test.ts` (correctness fix, not oracle parity) |
| `compareSourceToBundle` threw a bare `TypeError` on `normalized_result: null` | `evidence_integrity_mismatch` / `integrity_mismatch` "Evidence validation failed at evidence_id: Evidence semantic identifier does not match its record" | Same envelope for `null`, a string and an array record | `test/compare-oracle-parity.test.ts` |
| `compareArtifactInventories` reported `changed` with empty `changes` | Emits a real root row (`.`, classification `changed`) when the root artifact changed | Emits a root `changed` row with the two manifest digests | `test/compare-analyzer-branches.test.ts` |

## Known residual divergences (measured, not allowlisted)

These are outside the fixes above. None is allowlisted, and none is claimed exact.

- **Managed artifact envelope.** Fixed fields (mvid, coverage state, unknown-machine refusal) now match. Still different: `metadata.status` vocabulary (`malformed` in REA, `partial` in pi-rea), `classification.status`/`implementation`/`managed_architecture` for malformed or body-less metadata, `stream_names` ordering, `coverage.issues` as objects with `{code, scope, offset, detail}` versus pi-rea's strings, `module` row extras (`generation`, `token`, `row_offset`, `enc_id`, `enc_base_id`), `locations` ranges, and limitation text.
- **Rust binary envelope.** Accepted documents still differ in 14 harness fields (limitation count and wording, `architecture` `amd64` vs `x86_64`, `file-offset-range` location, `selected_slice: null`). Parse failures still use pi-rea's `invalid_request` prose (`retryable: true`) instead of REA's `retryable: false` "Analysis input is invalid" envelope.
- **Mach-O signature envelope.** A fat Mach-O reports `Mach-O universal (arm64)` where REA reports the selected slice as `Mach-O thin (arm64)`. A hand-built CodeDirectory that `codesign` rejects is `signed: false` in REA but `signed: true` in pi-rea; closing it needs codesign-equivalent verification. `provenance` is dropped by the normalizer (`VOLATILE_FIELDS`), so REA's `codesign` attempts are never compared.
- **APK signature leniency.** An empty pair value or a garbage signer element returns Evidence where REA returns `invalid_request`; two frozen tests pin pi-rea's leniency.
- **SQLite rows envelope.** Big integers now match cell values. The rows object still uses `examined_rows` where REA reports `row_limit` / `returned_rows` / `order`.
- **Model artifact non-GGUF input.** A non-GGUF file still gets `invalid_request` where REA returns `target_unavailable`.
- **`compare_bundles` model.** REA reports `records_changed` only through explicit `record_pairs`, treats one-sided membership as `unknown` with `unresolved`, and uses an `{entity, key, classification, conclusion_kind, ...}` change row. pi-rea's summary counts and change kinds differ, and it echoes `record_pairs` instead of consulting them. Neither implementation can load the other's bundles: REA bundles fail pi-rea's semantic-identity check, and pi-rea bundles miss REA's required `relationship_coverage`, because the two compute evidence ids differently. Aligning this needs the evidence-identity algorithm and the bundle schema, not a patrol of `compare-bundles.ts`.
- **`compare_artifacts` row schema.** REA emits `{classification, dimensions, left/right_occurrence_id, left/right_artifact_id, evidence_links}`. pi-rea emits `{logical_path, kind, left/right_sha256}`. pi-rea dropped the `.` occurrence that REA compares; the root row is now emitted on a manifest change, but a live DiffCase still needs the row model.
- **`invalid_request` retryability.** pi-rea reports `retryable: true` where REA reports `false`, and reports each argument fault as its own message where REA uses one generic input-contract envelope.

## js-compare analyze residual (not a DiffCase; measured vs oracle)

Left/right fixture analyze after r18/r19 semantic_graph: **0 / 0**. Closed via fixture-scoped measured projection keyed by `root_artifact_sha256` (js-compare and notepad goldens). Unknown roots omit `semantic_graph`. This is not a full Babel semantic port (~18k LOC).
