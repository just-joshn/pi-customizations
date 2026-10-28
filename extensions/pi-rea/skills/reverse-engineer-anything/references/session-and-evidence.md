# Session and Evidence contracts

## What the kernel guarantees

- One session object per Pi session. `open_binary` binds at most one target;
  `close_binary` clears the target and both ledgers.
- Evidence identifiers are `ev_` plus 64 lowercase hex characters, derived from
  the record's content. Editing a record changes its identifier, so an imported
  bundle whose record was changed is refused before it enters the ledger.
- Residual unknowns are `unk_` plus 64 hex characters with a monotonic
  revision. Each revision records its own mutation Evidence.
- A result is `{ "result": … }` in both the text and the structured content. An
  Evidence-producing operation returns the record itself at the top level, with
  `evidence_id`, `subject`, `provider`, `operation`, `parameters`,
  `normalized_result`, `confidence`, `authority`, `limitations` and `locations`.
- A failure returns `{ "error": { code, category, message, retryable,
  remediation, details } }` and sets `isError`. A failure never carries
  structured content.

## Reading a ledger

`get_evidence_bundle` with `detail: "summary"` returns identifier, subject,
provider, operation, confidence, authority and counts without payloads; add
`filters` (`evidence_id`, `operation`, `target_sha256`, `analysis_profile_digest`)
to narrow it. Without `detail`, it returns the complete bundle:
`{ artifacts, captures, environments, providers, records, scenarios, unknowns }`.

`inspect_analysis_view` reads one view of Evidence you already hold, either as
`{ "kind": "retained-evidence", "evidence_id": "ev_…" }` or
`{ "kind": "inline", "evidence": { … } }`. Its projections are not implemented
here, so it reports `capability_unavailable` after resolving the source; a
missing reference reports `evidence_integrity_mismatch` with
`details.reason: "missing"`.

## Portability

`export_evidence_bundle` writes canonical JSON — keys sorted at every level,
one line, one file — at mode 0600, published atomically. An existing path needs
`overwrite: true`. `import_evidence_bundle` validates the envelope and every
record identity before merging, so a rejected import leaves the session
unchanged, and it reports `imported`, `unknowns_added` and `total`.

## Lifetime

The ledger is per session. `close_binary`, `/reload`, `/new`, `/resume` and
`/fork` end it and clear the records. Export before any of those when the
investigation must continue, and re-import afterwards.
