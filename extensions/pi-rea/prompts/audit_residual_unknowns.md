---
description: Review residual-unknown heads against retained Evidence, revision integrity, and declared authority without silently closing unanswered questions
argument-hint: "<audit_scope> [unknown_id] [evidence_id]"
---
Audit residual unknowns for the decision or risk scope `$1` using the session's single unknown ledger.

Rules:
- Never silently resolve an unanswered question. Closing a head requires `update_unknown` with an explicit resolution and Evidence.
- There is one ledger. Do not invent a second store or parallel unknown file.

Steps:
1. Call `list_unknowns`. If `$2` is set, focus that head; otherwise review every active head relevant to `$1`.
2. If `$3` is set, inspect that Evidence with `inspect_analysis_view` or `get_evidence_bundle` and check whether it actually supplies the authority and confidence the unknown declared.
3. For each head, state whether it stays unresolved, should be blocked, or can be resolved with a cited Evidence id. Apply `update_unknown` only when the Evidence is retained and sufficient.
4. Record new gaps discovered during the audit with `record_unknown` rather than burying them in prose.

Deliver a scope-shaped audit: which unknowns block `$1`, which Evidence closes them, and which questions remain open.
