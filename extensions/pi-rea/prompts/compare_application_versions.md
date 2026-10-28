---
description: Compare two shipped application artifacts through inventory and optional static evidence without equating missing data with unchanged behavior
argument-hint: "<left_target_path> <right_target_path> [left_manifest_id] [right_manifest_id] [focus_occurrence_id]"
---
Compare the baseline target `$1` with the candidate target `$2` using pi-rea native tools.

Rules:
- Missing Evidence is not proof of unchanged behavior. Say what was not observed.
- Do not invent deep-provider diffs. Unimplemented tools fail closed with `capability_unavailable`.

Steps:
1. For each path, choose the first tool from the bytes: `open_binary` then `inspect_artifact` for ZIP-family packages; `analyze_javascript_application` for directory/ASAR trees; `inspect_binary_layout` / `inspect_go_binary` for native binaries; `inspect_web_network_capture` only for HAR captures.
2. Retain both inventories in the same session when possible. Use `get_evidence_bundle` with `detail: "summary"` and filters to keep identifiers handy.
3. If `$3` or `$4` names a retained manifest Evidence id, validate it with `inspect_analysis_view` before trusting it as a baseline.
4. If `$5` names a retained occurrence to prioritize, treat it as a focus hint only. It does not authorize extraction beyond what the inventory tools already returned.
5. Record unresolved equivalence questions with `record_unknown`. Export before `close_binary` when the comparison must survive the session.

Report concrete deltas that Evidence supports, then the residual unknowns that block a stronger claim.
