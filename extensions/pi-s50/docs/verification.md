# About S50 verification

S50 reports `PR_READY` only when `prReadyBlockers` in `src/policy/completion.ts` returns no blockers. This page explains what feeds that predicate.

## Evidence states

| State | Satisfies a criterion |
| --- | --- |
| `MEASURED` at the current revision | yes |
| `MEASURED` at an older revision | no |
| `INFERRED` | no |
| `UNKNOWN` | no |
| `INCONCLUSIVE` | no |
| `STALE` | no |
| `FAILED` | no |

Every acceptance criterion needs its latest records to be `MEASURED` at the current revision, and the current revision must equal the frozen revision. `UNKNOWN` and `INCONCLUSIVE` never count as a pass.

`record_evidence` binds each record to `run.currentRevision`. The caller cannot choose the revision.

## How evidence becomes stale

Each record declares `dependencies`, a list of path globs (`*`, `**`, `?`). When the revision changes, through `revision_changed`, `integrate_node`, or `s50 resume` noticing a new `HEAD`:

1. For each claim, S50 takes its latest record.
2. If any changed path matches a dependency, S50 appends a `STALE` record that supersedes it.
3. If none match, S50 appends a copy at the new revision with the same state that supersedes it.
4. A record with no declared dependencies cannot show it is unaffected, so any change stales it.

Old records are never deleted. `evidence.jsonl` keeps the full history, and each new record names the one it supersedes. A `PR_READY` run whose revision changes moves back to `REVERIFY_STALE`.

## Review

The review is evidence too. `record_review` is accepted in `REVIEW`, or in `REVERIFY_STALE` after reviewed code changed. It must cover every required dimension:

- correctness and acceptance criteria
- domain invariants
- authorization and data integrity
- error handling
- concurrency
- migration safety
- architecture and module depth
- caller knowledge
- duplicate domain knowledge
- test quality and confirmed seams
- reader load
- dead or replaced code

A web UI run (browser or Electron consumer) adds the `frontend-design` contract review, `web-design-guidelines`, and `agent-browser` verification. It adds `vercel-react-best-practices` only when a run constraint names React or Next.js.

The review record depends on the union of the graph's write sets. Editing reviewed code stales it, and `PR_READY` needs a review at the current revision.

Findings carry severity, trigger, consequence, evidence, revision, owner, and reviewer. The coordinator sets the revision, so a reviewer cannot attach a finding to a revision other than the one it reviewed. Reviewers record findings. They do not patch.

### What "independent review" means

A review is independent only when the host reports `independentAgents: true`: a fresh agent, in its own context, that did not write the code. The coordinator decides the label from host capabilities, not from the caller. On a host without independent agents, the review is stored as `reduced: same-agent read-only review; no independent agents`. S50 never labels same-agent self-review as independent.

## Web guideline reproducibility

**Upstream fact.** `web-design-guidelines` fetches `https://raw.githubusercontent.com/vercel-labs/web-interface-guidelines/main/command.md` fresh on each run. Its rules can change between two reviews of the same code.

**S50 policy.** S50 does not modify the skill to pin the URL. The reviewer passes the fetched text as `guidelinesContent`. The coordinator stores its sha256, the locked commit of `web-design-guidelines`, and the application revision on the review record, and attaches the digest and commit to every finding recorded after it at that revision.

## Consumer routes

| Consumer kind | Route | Without the capability |
| --- | --- | --- |
| `browser`, `electron` | `agent_browser` | `INCONCLUSIVE`: driver unavailable |
| `cli`, `tui` | `drive_executable` | not applicable |
| `http`, `rpc` | `protocol_request` | not applicable |
| `library` | `public_api` | not applicable |
| `native` | `native_automation` | `INCONCLUSIVE`: native automation unavailable |

S50 never substitutes `agent-browser` for a consumer it cannot drive, and tests are never a substitute for an unavailable consumer path. When a route is unavailable, record `INCONCLUSIVE` evidence or apply `declare_inconclusive`. The run stops there until a real measurement arrives.

## Secrets

`redact` in `src/evidence/verification.ts` runs on every evidence, finding, diagnostic, prototype, and review text field before it is stored. It replaces bearer tokens, `Authorization:` headers, `sk-` keys, GitHub `ghp_` tokens, Slack `xoxb-` and `xoxp-` tokens, AWS `AKIA` key IDs, `password=` values, JWTs, and PEM private keys with `<REDACTED>`. Store references to environment variables or secure stores instead of values.

## Diagnostic-test exception

See [workflows.md](workflows.md#the-diagnostic-test-exception-bug).
