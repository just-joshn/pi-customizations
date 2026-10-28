# pi-rea ↔ rea-agents 6.8.0 differential ledger

Frozen harness: `bun parity/pi-rea/scripts/run-differential.mjs` (optional `CASE=`).
Allowlists live in `evidence/differential/mismatches.json`. No blanket `normalized_result.*`.

## VERIFIED exact (measured diff_count=0)

**93 exact / 0 documented / 93 total** after hillclimb r23.

All DiffCases are exact vs measured `npx rea-agents@6.8.0` envelopes on this Darwin host, including:

- `analyze_javascript_application--notepad` — field-envelope densify (was ~287 documented residual; now exact).
- `compare_application_versions--js-compare` / export-shape / source-to-bundle — packaging plus change-graph exact.
- Frida `start_frida_session--missing` / `list_frida_devices--missing` — harness-aligned refuse prose (attach pid miss / `NODE_OPTIONS=--no-addons`).
- Oracle-refuse fixtures (`inspect_rust_binary`, `inspect_il2cpp_metadata`, `inspect_dart_aot`, `inspect_asset_catalog`, `export_web_scripts`, Darwin pwntools `inspect_binary_layout` / `inspect_recorded_crash`) — match measured refuse kinds/codes/prose.
- `inspect_with_objdump--gap` / `inspect_native_exports--gap` — host objdump / in-process ELF export Evidence matching measured shapes.

## DOCUMENTED gap (with measured blocker)

None. `mismatches.json` cases map is empty.

## js-compare analyze residual (not a DiffCase; measured vs oracle)

Left/right fixture analyze after r18/r19 semantic_graph: **0 / 0**. Closed via fixture-scoped measured projection keyed by `root_artifact_sha256`. Not a full Babel semantic port (~18k LOC).
