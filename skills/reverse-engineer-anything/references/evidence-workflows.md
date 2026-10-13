# Evidence, views, unknowns and verification

Every command that produces a finding writes one Evidence record and reports it. The record is the
unit of truth; a conclusion that cannot cite one is a question, not a finding.

## The Evidence envelope

| Field | What it tells you |
| --- | --- |
| `evidence_id` | `ev_` + 64 hex, a function of the operation, its parameters, the subject digest and the result. The same input yields the same ID, so repeating an analysis is detectable and cheap. |
| `subject` | `name`, `digest.sha256` (the bytes that were read), `format`, `architecture`, `local_path` |
| `provider`, `predicate_type`, `operation` | Which implementation produced it and what it is a statement about |
| `parameters` | The exact inputs, so a reader can tell two runs apart |
| `normalized_result` | The operation's data (graph, inventory, metadata) |
| `confidence`, `authority` | Envelope-level confidence (`derived` for a static analysis) and evidence authority (`shipped-artifact`) |
| `environment` | `null` unless the operation ran something. Static evidence always has `null` here. |
| `limitations` | What this result does not establish. Reproduce these; do not summarize them away. |
| `locations`, `evidence_links` | Where the evidence sits, and which other records it derives from |

Inside a graph or inventory, each observation carries its own `evidence`:

- `authority`: `artifact-bytes` (read from a file), `ast-static-analysis` (read from inert syntax),
  `static-relationship-inference` (a relationship between pieces, not a value).
- `state`: `observed` for a value present in the bytes, `inferred` for a relationship. A static
  analysis never produces `observed` execution. If you see a record claiming an execution
  observation with no runtime environment, treat it as a defect and say so.
- `confidence`: `low`, `medium`, `high` or `exact`.
- `coverage`: `{status, truncated, omitted_count, limits}`. `truncated: true` always names how much
  was omitted.
- `limitations`: the observation's own boundary.

## Coverage decides what you may claim

- `complete` — the search covered everything it says it covered.
- `partial` — something was capped, skipped or unparsable. A missing match is **not** absence.
- `unavailable` — there was nothing to read (no symbol table, no buildinfo marker). Say what was
  searched, then stop.

An absence claim needs complete coverage of the thing you are claiming about. Otherwise write
"not found in the searched set" and record an unknown for the rest.

## Views, paging and reuse

```bash
node scripts/rea.mjs inspect-analysis-view <evidence_id> --view summary --json
node scripts/rea.mjs inspect-analysis-view <evidence_id> --view section --selector <kind|node_id> --limit 20 --offset 40 --json
node scripts/rea.mjs inspect-analysis-view <evidence_id> --view item --selector <node_id> --json
node scripts/rea.mjs inspect-analysis-view <evidence_id> --view inventory --collection occurrences --json
node scripts/rea.mjs inspect-analysis-view <evidence_id> --view api-surface --json
```

A view returns a **new** record whose `evidence_links` cite the producer. It never re-runs the
producer and never upgrades its coverage. Paging reports `offset`, `returned`, `remaining` and
`total`; `coverage.source_complete` is a separate statement about the original analysis.

If two graph roles share one path, `--view item --selector <path>` refuses and lists the candidate
`node_id`s. Select the ID.

## Residual unknowns

An unknown is a question with the evidence it would need. It is not a finding and not a TODO.

```bash
node scripts/rea.mjs record-unknown --question "Which code path writes the settings file?" \
  --severity medium --domain storage --required-authority static-relationship-inference \
  --required-confidence high --supporting <evidence_id> --recommended-probe "trace writes from the main entrypoint" --json

node scripts/rea.mjs list-unknowns --json
node scripts/rea.mjs list-unknowns --status unresolved --severity high --json

node scripts/rea.mjs update-unknown <unknown_id> --expected-revision 1 --status resolved \
  --resolution-statement "The main process writes it in a single literal call." \
  --resolution-evidence <evidence_id> --json
```

- Recording the same question twice is rejected; update the existing unknown instead.
- Every update appends an immutable revision and requires the `expected_revision` you read. A stale
  revision is refused with `revision_conflict` — re-read, then retry. Never retry blindly.
- Resolving requires cited evidence that meets the unknown's `required_authority` and
  `required_confidence`. A resolution without qualifying evidence is refused; leave the unknown open
  instead of weakening its requirement.

## Audit the session before quoting it

```bash
node scripts/rea.mjs discipline-audit --json                  # the current session
node scripts/rea.mjs discipline-audit --bundle <path> --json  # an exported bundle
```

The audit checks the rules a report must satisfy: every record states its limitations; every
observation carries limitations and coverage; nothing claims observed execution without a runtime
record; a truncated observation names its omission; and every cited evidence ID resolves. It also
lists the records whose coverage is complete enough to support an absence claim.

## Export, import and verification

```bash
node scripts/rea.mjs evidence-export /path/session.rea-bundle.json --stable --json
node scripts/rea.mjs evidence-import /path/session.rea-bundle.json --json
```

An export contains every retained record and unknown. `--stable` omits the timestamp so two exports
of an unchanged session are byte-identical. Import validates each record's content address before
writing anything: a record whose bytes do not hash to its `evidence_id` is refused with
`evidence_integrity_mismatch`.

Before finishing, check the chain: every evidence ID you cite resolves in the bundle, every open
question is in the unknown list, and no conclusion rests on a partial result presented as complete.
