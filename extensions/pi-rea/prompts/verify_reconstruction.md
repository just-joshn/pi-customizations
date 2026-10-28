---
description: Evaluate a finite reconstruction specification against retained Evidence without broadening a pass into global equivalence
argument-hint: "<reconstruction_goal> [comparison_evidence_id] [provider_id]"
---
Verify the finite reconstruction goal `$1` against retained pi-rea Evidence.

Constraints:
- A pass means only the declared goal holds on the cited Evidence. Never upgrade that into global equivalence with the original artifact.
- Prefer retained records over re-running producers. Use `inspect_analysis_view` (`summary`, then narrower kinds when needed) before repeating analysis.
- Deep providers named by `$3` are not implemented in this port; if requested, report `capability_unavailable` as a coverage gap.

Steps:
1. Call `binary_session` and `list_unknowns` to see the open target and residual questions.
2. If `$2` is set, load that comparison Evidence via `inspect_analysis_view` or `get_evidence_bundle`. Otherwise gather the smallest new Evidence that can decide `$1` (`inspect_binary_layout`, `analyze_javascript_application`, `inspect_artifact`, `inspect_go_binary`, or `inspect_web_network_capture` as appropriate).
3. State each claim as observation, inference, or unknown. Use `record_unknown` / `update_unknown` for gaps that the available tools cannot close.
4. Export with `export_evidence_bundle` if the verdict must leave the session.

Answer with pass, fail, or inconclusive for `$1`, citing Evidence ids and the tool that produced each fact.
