# pi-rea

REA (Reverse Engineer Anything) as a Pi-native extension: REA's tool interface,
its session and Evidence kernel, and a reverse-engineering workflow skill,
reimplemented with Pi's own mechanisms.

`pi-rea` is an independent implementation. It contains no REA code, depends on
no REA package, and never calls the REA CLI or MCP server. Tool names, parameter
sets and observed result shapes are kept for compatibility; every description,
schema and line of code here is this project's own (see
[Independence](#independence)).

This package advertises the **rea-agents 6.8.0** agent-facing catalog (**229
tools**). **63** of them are implemented handlers (the session/Evidence kernel
and absorbed static analyzers); the other **166** are registered fail-closed
provider or capability refuses that match measured REA 6.8.0 missing-provider
envelopes. `binary_session` reports that split, and `schemas/tool-contracts.json`
records it as `counts.implemented: 63`, `counts.unavailable: 166`. Catalog size
is not behavioral parity.

Measured DiffCase parity lives under `parity/pi-rea/`: **108** frozen cases are
exact vs `npx` `rea-agents` 6.8.0 envelopes on the Darwin host that ran the
harness, including `binary_session`, `open_binary`, `close_binary` and the PE
import budget/boundary paths. That smoke includes fixture-scoped
`semantic_graph` goldens for known roots and harness-aligned refuse prose for
some missing providers. It does not prove a full Babel semantic port, live
Frida/ADB bridges, or a DiffCase for every catalog name; measured residual
envelope divergences are listed in `parity/pi-rea/parity-ledger.md`.

## What works today

| Area | Status |
| --- | --- |
| Complete tool interface (229 tools, rea-agents 6.8.0) | Every parameter, annotation and effect flag REA publishes is advertised; `test/contract.test.ts` checks each published parameter name against the oracle capture. Where REA publishes a reduced-form object schema, pi-rea also carries the documented field detail, so its schema is a superset and never a subset of REA's |
| Session and Evidence kernel | Implemented (`binary_session`, open/close, `open_bundle_resources`, Evidence export/import/view, unknowns, `verify_unknown_resolution`, analysis settings) |
| Absorbed static analyzers (5) | Implemented: `analyze_javascript_application`, `inspect_artifact`, `inspect_binary_layout`, `inspect_go_binary`, `inspect_web_network_capture` (HAR only) |
| `inspect_plist` / `inspect_macho` / `inspect_pe_resources` / `list_architectures` | Implemented |
| Engine-free PE/ELF/Rust/IPS/entropy inspectors (7) | Implemented: `inspect_pe_imports`, `inspect_pe_certificates`, `inspect_pe_load_config`, `inspect_elf_notes`, `inspect_rust_binary`, `inspect_apple_ips`, `inspect_byte_entropy` |
| Engine-free model/SQLite/BEAM/desktop/GPU/IL2CPP/pyc/ko/DTB inspectors (9) | Implemented: `inspect_model_artifact`, `inspect_sqlite_database`, `inspect_erlang_beam`, `inspect_desktop_application`, `inspect_gpu_code_objects`, `inspect_il2cpp_metadata`, `inspect_python_pyc`, `inspect_kernel_module`, `inspect_devicetree` |
| Engine-free APK/Electron/Mach-O signature/bundle/managed/Flutter inspectors (10) | Implemented: `inspect_apk_signature`, `inspect_electron_fuses`, `inspect_signature`, `inspect_keyed_archive`, `inspect_asset_catalog`, `inspect_managed_artifact`, `inspect_managed_members`, `open_bundle_resources`, `identify_flutter_build`, `inspect_dart_aot` |
| Engine-free demangle/IB/compare/extract/core inspectors (8) | Implemented: `demangle_swift`, `decode_interface_builder`, `compare_artifacts`, `compare_bundles`, `compare_managed_members`, `extract_artifact`, `inspect_recorded_crash`, `list_cutter_sessions` (a Cutter bridge is not implemented, so every other Cutter tool refuses closed) |
| Engine-free JS/web/Apple graph tools (5) | Implemented: `compare_javascript_export_shapes`, `compare_application_versions`, `compare_source_to_bundle`, `export_web_scripts`, `project_apple_application_graph` |
| Official-proxy / enhanced session family (~52) | Kernel fail-closed: navigation/procedure/address/comment/bookmark/search/`read_bytes` plus enhanced decompile/overview tools; `target_unavailable` when closed, `provider_unavailable` (ghidra/hopper/ida/kuna) when open |
| Frida / ADB / CDP / JEB / Rizin / GDB / apktool / binwalk / Wakaru / jadx (~79) | Fail-closed with measured `capability_unavailable` or CDP `provider_unavailable`/`endpoint_unreachable` envelopes; no invented device/page findings |
| Selected compare_* fail-closed (4) | `compare_functions`, `compare_process_captures`, `compare_wasm_interfaces`, `find_changed_behavior` |
| WABT / TShark / pcap / sigrok / EVM (8) | Kernel fail-closed with measured missing-provider envelopes (`wabt-artifact`, `tshark-capture`, `pcap`, `sigrok-recording`, `evmole-interface`) |
| Native observe / dylib (4) | Kernel fail-closed: `target_unavailable` when closed, `capability_unavailable`/`native-macos` when open (no LLDB bridge) |
| Engine-free / host Evidence (selected) | `inspect_with_objdump` and `inspect_native_exports` emit measured Evidence; other reconstruction/process/env gaps still refuse closed |
| Six Pi prompt templates under `prompts/` | Implemented (`investigate_feature`, `compare_application_versions`, `verify_reconstruction`, `trace_crash`, `audit_residual_unknowns`, `prepare_bounded_process_capture`) |
| `route` helper | Skill/CLI helper only; not an oracle MCP tool in 6.8.0 |
| `rea` CLI | Not implemented inside this package |
| Deep-analysis providers (Hopper, Ghidra, IDA, Kuna) | Not bridged; session tools refuse with measured unavailable vocabulary |
| Live process/browser/device capture | Not bridged; Frida/ADB/CDP handlers refuse closed |

An unimplemented call answers with the canonical error envelope. It never
returns a substitute result, so a coverage gap can never be mistaken for a
finding about a target. `parity/pi-rea/` records the baseline and decisions.

## Install

```sh
# from a clone of this repository
pi install ./extensions/pi-rea
```

During development, load the entry directly:

```sh
pi -e ./extensions/pi-rea/src/index.ts
```

The extension registers its 63 implemented handlers with `direct` exposure and
the 166 refuse handlers with `deferred`, so `tool_search` carries the catalog
instead of filling the prompt with tools that cannot run. A refuse is a coverage
gap, never a finding about the target.

Remove it with `pi remove ./extensions/pi-rea`.

## Regenerating the contract

```sh
cd extensions/pi-rea
bun run generate:contracts
```

`scripts/generate-contracts.ts` rebuilds `schemas/tool-contracts.json` from
`parity/pi-rea/rea-6.8.0-tools-list.json` and marks kernel tools from
`schemas/kernel-manifest.json`, which `test/contract.test.ts` checks against the
registered handler table in `src/registry.ts`. Every parameter the oracle
publishes survives regeneration; the script only adds documented field detail
where the oracle schema is a bare object. Do not hand-edit the generated catalog.

## Use

Ask for an investigation that depends on a shipped artifact rather than source:

```text
Open /usr/local/bin/thing, tell me its format, architecture and digest, and note
what you could not establish about it.
```

Typical kernel session:

1. `binary_session` — what is available, what is open, what provider exists.
2. `open_binary` — bind a file and read its identity (format, kind, architecture,
   SHA-256).
3. `record_unknown` — keep every open question explicit, with the authority and
   confidence a resolution would need.
4. `get_evidence_bundle` / `export_evidence_bundle` — read or publish the session
   as canonical JSON. `close_binary` clears the session, so export first.
5. `close_binary` — drain, clear and finish.

`/rea` prints the current status: open target, availability counts and retained
Evidence.

## Independence

- No REA dependency: no npm package, no vendored code, no CLI, no MCP server, no
  network, no child process.
- No REA bytes: the shipped contract transcribes interface facts only (tool
  names, parameter names, types, bounds, required sets, flags, effect metadata,
  observed result shapes). The reference's prose, titles, examples, defaults,
  per-mode remediation text and output schemas are excluded, and every
  description is written here.
- The workflow skill is this project's own text.

`extensions/pi-rea/test/independence.test.ts` enforces this over the shipped
source, schemas, skills and prompts, and over `package.json`. It does not scan
`README.md` or `THIRD_PARTY_NOTICES.md`, which carry no code.

## Verification

```sh
cd extensions/pi-rea
bun run test
bun run typecheck
```

`bun run typecheck` exits 0. `bun run test` passes 1496 tests in 43 files.
`bun run test:coverage` meets its configured 80% thresholds: the measured suite
covers 97.49% of statements, 90.87% of branches, 98.21% of functions and 98.47%
of lines. Behavior tests drive the absorbed analyzers through their public
functions with synthetic bytes and real fixtures; the successful paths are also
exercised through the DiffCase envelopes in `parity/pi-rea/`.

Oracle captures, design notes and decisions live under
[`parity/pi-rea/`](../../parity/pi-rea/).

## State and lifetime

The Evidence ledger and the unknown ledger follow the active Pi branch. Each
Evidence-producing tool mirrors its record into the tool result's `details` and
appends a `rea-evidence` entry with `pi.appendEntry`; `record_unknown` and
`update_unknown` append `rea-unknown` entries alongside their mutation Evidence.
`session_start` rebuilds both ledgers from `ctx.sessionManager.getBranch()`, so a
`/fork` or `/resume` sees exactly the records its branch holds, and an abandoned
branch cannot leak into the live one. `close_binary` still clears both ledgers in
the running session. `export_evidence_bundle` publishes them as canonical JSON,
and `import_evidence_bundle` restores them; identifiers stay stable across the
round trip.

## Limits

- Nothing here starts an analysis engine: the deep-analysis surface works only
  once a provider bridge exists.
- Pi owns the agent loop, tool lifecycle, sessions and permissions; pi-rea only
  registers tools and session state through the public extension API.
- Evidence identifiers are content-addressed with this project's projection, so
  a bundle exported by REA itself is refused by the identity check rather than
  silently re-identified (`KERN-044`).
- Provider-gated and engine-free-gap tools are declared but refuse closed with
  measured unavailable envelopes; never treat those refuses as target findings.
- An oversized result is truncated, not rejected. The 10 MiB budget stays as the
  truncation threshold, and an oversized payload is replaced by
  `{truncated, response_budget_bytes, required_bytes, guidance}`. This is a
  deliberate divergence from REA, whose transport rejects the frame: Pi's
  extension docs require truncating large model-facing results and telling the
  model where to read the rest, and Pi has no frame limit that needs the refusal.
  Evidence results keep the full record in the tool result's `details` and the
  guidance points at `export_evidence_bundle`; other payloads are not retained,
  so their guidance asks for a narrower request. `REA_MCP_MAX_RESPONSE_BYTES`
  still raises the threshold or lowers it for a caller that wants smaller results.

## License

MIT. See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
