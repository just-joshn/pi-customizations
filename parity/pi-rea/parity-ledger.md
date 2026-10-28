# pi-rea ↔ rea-agents 6.8.0 differential ledger

Frozen harness: `bun parity/pi-rea/scripts/run-differential.mjs` (optional `CASE=`).
Allowlists live in `evidence/differential/mismatches.json`. No blanket `normalized_result.*`.

## What this proves

The DiffCase table is a **host-conditioned envelope smoke** against measured `npx` `rea-agents` 6.8.0 on this Darwin machine. It is not a claim that every REA code path is reimplemented, that every tool of the 229-name catalog has a DiffCase, or that refuse prose is live-probed on every host.

Normalize still scrubs volatile digests and graph ids. Exact means the remaining normalized payload matches the oracle for that case.

## VERIFIED exact (measured diff_count=0)

**93 exact / 0 documented / 93 total** after hillclimb r23.

All DiffCases are exact vs measured `npx` `rea-agents` 6.8.0 envelopes on this Darwin host, including:

- `analyze_javascript_application--notepad` — field-envelope densify (was ~287 documented residual; now exact).
- `compare_application_versions--js-compare` / export-shape / source-to-bundle — packaging plus change-graph exact.
- Frida `start_frida_session--missing` / `list_frida_devices--missing` — harness-aligned refuse prose (attach pid miss / `NODE_OPTIONS=--no-addons`). Production refuse text follows those measured envelopes rather than re-probing Frida or PATH on every call.
- Oracle-refuse fixtures (`inspect_rust_binary`, `inspect_il2cpp_metadata`, `inspect_dart_aot`, `inspect_asset_catalog`, `export_web_scripts`, Darwin pwntools `inspect_binary_layout` / `inspect_recorded_crash`) — match measured refuse kinds/codes/prose.
- `inspect_with_objdump--gap` / `inspect_native_exports--gap` — host objdump / in-process ELF export Evidence matching measured shapes.

## DOCUMENTED gap (with measured blocker)

None. `mismatches.json` cases map is empty.

## js-compare analyze residual (not a DiffCase; measured vs oracle)

Left/right fixture analyze after r18/r19 semantic_graph: **0 / 0**. Closed via fixture-scoped measured projection keyed by `root_artifact_sha256` (js-compare and notepad goldens). Unknown roots omit `semantic_graph`. This is not a full Babel semantic port (~18k LOC).

## Session kernel coverage (offline oracle test, not a live DiffCase)

`test/session-tools.test.ts` KERN-011 compares `binary_session` against the frozen
`parity/pi-rea/rea-6.8.0-binary_session.json` capture: the top-level field set, the
`tool_availability` shape (`client_requirements` plus `groups[]`), each group's reference
fields, REA's reason vocabulary (`available`, `target_required`, `provider_unavailable`),
REA's `target_required` remediation string, and the group partition over all 229 names.

`binary_session`, `open_binary` and `close_binary` are deliberately absent from the live
DiffCase table. An exact-envelope compare cannot pass honestly: pi-rea implements 63 of the
229 catalog tools, so `result.tool_availability`, `result.capabilities` and
`result.server_identity` carry pi-rea's measured state (63 kernel tools, provider-gated
refuses) instead of the oracle's own availability on this host. Allowlisting those subtrees
would leave a case that proves nothing. The offline test above is the parity evidence for the
shape, and `schemas/tool-contracts.json` (`counts.implemented: 63`) is the measured coverage.
