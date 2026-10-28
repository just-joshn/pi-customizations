---
description: Trace a feature through artifact, symbol, and function evidence while separating observations, inferences, and residual unknowns
argument-hint: "<feature> [target_path] [document] [procedure] [provider_id]"
---
Investigate the feature or behavior named `$1` using pi-rea's native tools only (never `mcp__rea__*` names).

Target binding:
- If `$2` is set, call `open_binary` with that absolute path when the target is a file the kernel can identify. For a JavaScript or Electron directory/ASAR, call `analyze_javascript_application` with `input_path` instead.
- If `$2` is empty, call `binary_session` and reuse the open target when one already exists.

Workflow:
1. Call `binary_session` and read which tools are actually available. Treat `capability_unavailable` as a coverage gap in this port, never as a finding about the target.
2. Prefer static inventory first: `inspect_artifact` for ZIP-family archives after `open_binary`, `inspect_binary_layout` for native binaries, `inspect_go_binary` when Go buildinfo may be present, `analyze_javascript_application` for JS/Electron trees.
3. Prefer `$4` as a procedure or address hint when set. Prefer `$3` only as a provider document name when a deep provider is available; deep providers are not implemented in pi-rea yet and must fail closed without inventing decompilation.
4. Record every residual question with `record_unknown`. Keep observations, inferences, and unknowns in separate sentences.
5. Use `inspect_analysis_view` with `view.kind: "summary"` on retained Evidence before asking for larger pages. Export with `export_evidence_bundle` before `close_binary` if the investigation must continue later.

Answer with the shortest Evidence-backed account of how `$1` works, what remains unknown, and which tool produced each claim. Optional provider preference `$5` is advisory only when that capability is available.
