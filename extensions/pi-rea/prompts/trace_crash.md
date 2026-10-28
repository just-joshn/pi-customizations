---
description: Correlate a crash symptom with static call and reference evidence plus optional process-capture observations
argument-hint: "<crash_signal> [target_path] [document] [procedure] [capture_evidence_id]"
---
Trace the crash signal `$1` with pi-rea native tools.

Binding:
- Open `$2` with `open_binary` when it is a supported file, or analyze it with `analyze_javascript_application` when it is a JS/Electron tree. Reuse the open target when `$2` is empty.
- Treat `$4` as a procedure or address hint when present.
- If `$5` is a retained process-capture Evidence id, project it with `inspect_analysis_view`. Do not invent runtime facts when no capture Evidence exists. Process capture tools that are still unimplemented fail closed.

Workflow:
1. Establish static context first (`inspect_binary_layout`, `inspect_macho`, `inspect_plist`, `inspect_go_binary`, or `analyze_javascript_application` as the target warrants).
2. Separate observed crash text from inferred causes. Record every open causal question with `record_unknown`.
3. Prefer `$3` only when a deep provider document is actually available. Otherwise stay on the in-process analyzers and say what you could not decompile.
4. Export before `close_binary` when the crash dossier must persist.

Return the shortest causal chain that Evidence supports, then the residual unknowns that still block a definitive root cause.
