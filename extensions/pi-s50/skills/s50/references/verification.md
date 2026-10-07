# Verification and PR-ready

`s50 verify` prints the consumer route, each acceptance criterion as `MEASURED` or `MISSING`, and PR-ready blockers.

## Consumer routes

| Consumer kind | Route | Without capability |
| --- | --- | --- |
| browser, electron | `agent_browser` | `inconclusive` (driver unavailable) |
| cli, tui | `drive_executable` | |
| http, rpc | `protocol_request` | |
| library | `public_api` | |
| native | `native_automation` | `inconclusive` (automation unavailable) |

Exercise the real consumer path, then record evidence (bound to the current revision; secrets are redacted):

```json
{"kind":"record_evidence","evidence":{"claim":"...","criterion":"<acceptance criterion>","state":"MEASURED","dependencies":["src/x/**"],"method":"cli","expected":"...","observed":"...","artifact":"..."}}
```

States: `MEASURED`, `INFERRED`, `UNKNOWN`, `INCONCLUSIVE`, `STALE`, `FAILED`. Only `MEASURED` satisfies a criterion.

## Revisions and staleness

```json
{"kind":"revision_changed","revision":"<sha>","changedPaths":["src/x/a.ts"]}
{"kind":"freeze_revision"}
```

Changed paths stale matching evidence. `s50 resume` detects new HEADs. Re-measure in REVERIFY_STALE.

## Findings

```json
{"kind":"record_finding","finding":{"severity":"high","trigger":"...","consequence":"...","evidence":"...","owner":"...","reviewer":"...","guidelines":null}}
{"kind":"resolve_finding","id":"<id>","resolution":"resolved"}
```

Reviewers do not patch. Same-agent review is reduced assurance, never independent.

## Authorization

```json
{"kind":"request_authorization","action":"merge","scope":"..."}
```

Actions: `force_push`, `merge`, `deploy`, `destructive_data_deletion`, `public_message`, `customer_communication`, `sensitive_data_disclosure`, `irreversible_action`. Stop after requesting. Only the user grants: `{"kind":"grant_authorization","action":"merge","scope":"..."}` with the exact scope.

## PR_READY requires

All criteria `MEASURED` at the frozen revision equal to the current revision; no open findings; every graph node integrated; no red diagnostic loop; bug runs have a root cause and a promoted diagnostic.
