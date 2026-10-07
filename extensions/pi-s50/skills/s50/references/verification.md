# Verification

## Consumer routes

| Consumer | Route | Evidence method | Without the capability |
| --- | --- | --- | --- |
| `browser`, `electron` | `agent_browser` | `browser` | INCONCLUSIVE |
| `cli`, `tui` | `drive_executable` | `cli` | not applicable |
| `http`, `rpc` | `protocol_request` | `http` | not applicable |
| `library` | `public_api` | `library` | not applicable |
| `native` | `native_automation` | `native` | INCONCLUSIVE |

Measure each acceptance criterion through the route, at the current revision:

```json
{"kind":"record_evidence","evidence":{"claim":"csv-output","criterion":"csv lists every invoice","state":"MEASURED","dependencies":["src/export/**"],"method":"cli","expected":"one row per invoice","observed":"3 rows for 3 invoices","artifact":".s50/artifacts/csv-output.log"}}
```

A criterion passes only when its latest records are all MEASURED at the current revision and one of them used the consumer's method. Tests and reviews never stand in for the consumer path. Without a driver, record the INCONCLUSIVE evidence or declare it:

```json
{"kind":"declare_inconclusive","missing":"agent-browser is not installed"}
```

Dependencies are path globs, `node:<id>`, or `interface:<name>`. A changed path, or the integration of a matching node or interface, stales the record. Every surface reads changed paths from Git before each command, and a `revision_changed` must name the current `HEAD`.

## Review

In REVIEW, or in REVERIFY_STALE after reviewed code changed, cover every dimension that `nextAction` lists, record findings, then the review:

```json
{"kind":"record_finding","finding":{"severity":"medium","trigger":"invoice name with a comma","consequence":"CSV columns shift","evidence":".s50/artifacts/comma.csv","owner":"IMPLEMENT","reviewer":"reviewer-1"}}
{"kind":"resolve_finding","id":"finding-1","resolution":"resolved"}
{"kind":"record_review","reviewer":"reviewer-1","independent":false,"dimensions":["correctness_and_acceptance_criteria","domain_invariants","authorization_and_data_integrity","error_handling","concurrency","migration_safety","architecture_and_module_depth","caller_knowledge","duplicate_domain_knowledge","test_quality_and_confirmed_seams","reader_load","dead_or_replaced_code"],"guidelinesContent":null}
```

Set `independent` true only when a fresh agent that did not write the code ran the review. The coordinator stores reduced assurance otherwise, and also when the host has no independent agents or the reviewer owns a node or integrated the revision. Reviewers record findings; they do not patch. A patch makes a new revision, which stales the review.

## Failures

Route a failed check to the phase that owns it:

```json
{"kind":"route_failure","check":"consumer","detail":"exit 1 on an empty invoice list"}
```

Owners: `typecheck`, `unit_test`, `integration_test`, `consumer`, `review` go to IMPLEMENT; `design` to DESIGN; `architecture` to ARCHITECT; `seam` to CONFIRM_TDD_SEAMS; `stale_evidence` to REVERIFY_STALE. The move must be a legal edge from the current phase.

## Authorization

```json
{"kind":"request_authorization","action":"merge","scope":"PR 64"}
```

Only the user grants it, with the exact action and scope. During a run, a bash command that force-pushes, merges a PR, deploys, deletes data destructively, publishes, or posts publicly asks the user first, or is blocked without a UI.

## PR_READY

PR_READY needs: no open gate, not INCONCLUSIVE, the frozen revision equal to the current one, every criterion proven, a review at the current revision, no open finding, every node integrated, and for bugs a green promoted reproducer with no instrumentation left. PR_READY stays live: any change that reopens a blocker moves the run back to REVERIFY_STALE.
