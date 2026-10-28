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
tools**). All **229** are registered as kernel handlers today: absorbed static
analyzers plus fail-closed provider/capability refuses that match measured REA
6.8.0 missing-provider envelopes. Do not read that catalog size as behavioral
parity. Gaps belong under `parity/pi-rea/`.

## What works today

| Area | Status |
| --- | --- |
| Complete tool interface (229 tools, rea-agents 6.8.0) | Advertised with REA's parameter sets, annotations and effect flags |
| Session and Evidence kernel | Implemented (`binary_session`, open/close, `open_bundle_resources`, Evidence export/import/view, unknowns, `verify_unknown_resolution`, analysis settings) |
| Absorbed static analyzers (5) | Implemented: `analyze_javascript_application`, `inspect_artifact`, `inspect_binary_layout`, `inspect_go_binary`, `inspect_web_network_capture` (HAR only) |
| `inspect_plist` / `inspect_macho` / `inspect_pe_resources` / `list_architectures` | Implemented |
| Engine-free PE/ELF/Rust/IPS/entropy inspectors (7) | Implemented: `inspect_pe_imports`, `inspect_pe_certificates`, `inspect_pe_load_config`, `inspect_elf_notes`, `inspect_rust_binary`, `inspect_apple_ips`, `inspect_byte_entropy` |
| Engine-free model/SQLite/BEAM/desktop/GPU/IL2CPP/pyc/ko/DTB inspectors (9) | Implemented: `inspect_model_artifact`, `inspect_sqlite_database`, `inspect_erlang_beam`, `inspect_desktop_application`, `inspect_gpu_code_objects`, `inspect_il2cpp_metadata`, `inspect_python_pyc`, `inspect_kernel_module`, `inspect_devicetree` |
| Engine-free APK/Electron/Mach-O signature/bundle/managed/Flutter inspectors (10) | Implemented: `inspect_apk_signature`, `inspect_electron_fuses`, `inspect_signature`, `inspect_keyed_archive`, `inspect_asset_catalog`, `inspect_managed_artifact`, `inspect_managed_members`, `open_bundle_resources`, `identify_flutter_build`, `inspect_dart_aot` |
| Engine-free demangle/IB/compare/extract/core inspectors (7) | Implemented: `demangle_swift`, `decode_interface_builder`, `compare_artifacts`, `compare_bundles`, `compare_managed_members`, `extract_artifact`, `inspect_recorded_crash` |
| Engine-free JS/web/Apple graph tools (5) | Implemented: `compare_javascript_export_shapes`, `compare_application_versions`, `compare_source_to_bundle`, `export_web_scripts`, `project_apple_application_graph` |
| Official-proxy / enhanced session family (~52) | Kernel fail-closed: navigation/procedure/address/comment/bookmark/search/`read_bytes` plus enhanced decompile/overview tools; `target_unavailable` when closed, `provider_unavailable` (ghidra/hopper/ida/kuna) when open |
| Frida / ADB / CDP / JEB / Rizin / GDB / Cutter / apktool / binwalk / Wakaru / jadx (~80) | Kernel fail-closed with measured `capability_unavailable` or CDP `provider_unavailable`/`endpoint_unreachable` envelopes; no invented device/page findings |
| Selected compare_* fail-closed (4) | `compare_functions`, `compare_process_captures`, `compare_wasm_interfaces`, `find_changed_behavior` |
| WABT / TShark / pcap / sigrok / EVM (8) | Kernel fail-closed with measured missing-provider envelopes (`wabt-artifact`, `tshark-capture`, `pcap`, `sigrok-recording`, `evmole-interface`) |
| Native observe / dylib (4) | Kernel fail-closed: `target_unavailable` when closed, `capability_unavailable`/`native-macos` when open (no LLDB bridge) |
| Engine-free gap refuse (20) | Kernel fail-closed `engine-free`/`not_implemented` for exports/objdump/graphs/reconstruction/JS-web traces/process capture/env export until real parsers land |
| Six Pi prompt templates under `prompts/` | Implemented (`investigate_feature`, `compare_application_versions`, `verify_reconstruction`, `trace_crash`, `audit_residual_unknowns`, `prepare_bounded_process_capture`) |
| `route` helper | Skill/CLI helper only; not an oracle MCP tool in 6.8.0 |
| `rea` CLI | Not implemented inside this package |
| Deep-analysis providers (Hopper, Ghidra, IDA, Kuna) | Not bridged; session tools refuse with measured unavailable vocabulary |
| Live process/browser/device capture | Not bridged; Frida/ADB/CDP handlers refuse closed |

Installing both `extensions/pi-rea` and the repo-root
`skills/reverse-engineer-anything` package can register two skills with the same
name until cutover. Prefer the extension skill while this port is the active
surface; the root skill remains until a later cutover unit deletes it.

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

The extension registers all 229 kernel tools with `direct` exposure. Many of
those handlers still refuse closed (provider or engine-free gap); a refuse is a
coverage gap, never a finding about the target.

Remove it with `pi remove ./extensions/pi-rea`.

## Regenerating the contract

```sh
cd extensions/pi-rea
bun run generate:contracts
```

`scripts/generate-contracts.ts` rebuilds `schemas/tool-contracts.json` from
`parity/pi-rea/rea-6.8.0-tools-list.json` and marks kernel tools from
`schemas/kernel-manifest.json`. Do not hand-edit the generated catalog.

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

`extensions/pi-rea/test/independence.test.ts` enforces this over the files npm
would publish.

## Verification

```sh
cd extensions/pi-rea
bun run test
bun run typecheck
```

Oracle captures, design notes and decisions live under
[`parity/pi-rea/`](../../parity/pi-rea/).

## State and lifetime

The Evidence ledger and the active target belong to one Pi session. `close_binary`
clears them, and so do `/reload`, `/new`, `/resume` and `/fork`. `export_evidence_bundle`
before any of those when the investigation must continue, then `import_evidence_bundle`
into the next session; identifiers stay stable across the round trip.

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
- An oversized result is rejected at 10 MiB, the reference's own budget, rather
  than truncated. Pi has no equivalent frame limit, so a result near that size
  would enter the conversation whole; keep to summary detail for large records.

## License

MIT. See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
