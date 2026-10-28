# The residual-unknown ledger

A conclusion you cannot establish is a finding. Record it rather than dropping
it.

## Recording

`record_unknown` requires `question`, `severity` (`low`, `medium`, `high`,
`critical`), `domain`, `required_authority`, `required_confidence`,
`required_environment`, `recommended_probes` and `relationships`.
`supporting_evidence_ids` and `contradicting_evidence_ids` are optional and
default to empty; any identifier you pass must already be retained in the
session.

`required_authority` is the authority a resolution would need:
`shipped-artifact`, `controlled-replay`, `historical-reference`,
`external-service` or `analyst-inference`. `required_confidence` is the
confidence it would need: `observed`, `derived` or `inferred`.
`required_environment` is `{ id, platform, architecture, isolation }` or null,
where `isolation` is `none`, `process`, `container` or `virtual-machine`.

The result carries `unknown_id`, `revision`, `revision_digest`,
`previous_revision_digest`, `mutation_evidence_ids` and `status: "open"`.

## Keeping it current

`update_unknown` requires `unknown_id`, `expected_revision`, `status`,
`severity`, `supporting_evidence_ids`, `contradicting_evidence_ids`,
`required_authority`, `required_confidence`, `required_environment`,
`recommended_probes`, `relationships` and `resolution`. Statuses are `open`,
`investigating`, `blocked`, `contradicted` and `resolved`.

A resolution is null, `{ "disposition": "verified", "rationale": …,
"evidence_ids": [ "ev_…" ] }` with at least one identifier, or
`{ "disposition": "withdrawn" | "out-of-scope", "rationale": …,
"evidence_ids": [ … ] }`.

A stale `expected_revision` returns `revision_conflict` and changes nothing: a
refused update records no mutation Evidence. Read `list_unknowns` and retry with
the current revision.

`list_unknowns` returns `{ items, total }` and filters by `domain`, `severity`
and `status`.

## Before finishing

Revisit every open unknown. Mark it resolved with its verifying Evidence,
withdrawn, or out of scope — and say so in the answer. An unknown that is
neither resolved nor reported is a finding you failed to report.
