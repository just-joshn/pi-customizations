---
description: Choose a command, inputs, observations, and stopping conditions for a process capture that answers one behavioral question
argument-hint: "<behavior_question> <executable> <working_directory> [prior_capture_evidence_id]"
---
Prepare a bounded process-capture plan for behavior question `$1`.

Context:
- Executable: `$2`
- Working directory: `$3`
- Optional prior capture Evidence: `$4`

Important port boundary:
- Live process-capture tools in the 6.8.0 catalog are not implemented in pi-rea yet. They fail closed with `capability_unavailable`. This prompt produces a plan and residual unknowns; it must not pretend a capture ran.

Steps:
1. Call `binary_session`. If `$2` points at a local artifact, bind or inspect it with `open_binary`, `inspect_binary_layout`, or `analyze_javascript_application` so the plan names a real subject.
2. If `$4` is set, read that prior Evidence with `inspect_analysis_view` and reuse only facts it actually retained.
3. Write a capture plan with: exact command argv, cwd `$3`, inputs, observations to retain, redaction needs, and a hard stopping condition that answers `$1` without open-ended recording.
4. Record every prerequisite the port cannot satisfy (provider bridge, capture tool, device access) with `record_unknown` and the authority a resolution would need.
5. Prefer exporting the plan session with `export_evidence_bundle` when the operator will run the capture elsewhere.

Return the plan, the Evidence ids that justify it, and the unknowns that still block execution inside this port.
