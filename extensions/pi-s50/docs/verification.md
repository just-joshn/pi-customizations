# About S50 verification

S50 reports `PR_READY` only when `prReadyBlockers` in `src/policy/completion.ts` returns no blocker. This page explains what feeds that predicate.

## Evidence states

| State | Satisfies a criterion |
| --- | --- |
| `MEASURED` at the current revision, through the consumer's method | yes |
| `MEASURED` at an older revision | no |
| `MEASURED` through another method only, such as `test` | no |
| `INFERRED` | no |
| `UNKNOWN` | no |
| `INCONCLUSIVE` | no |
| `STALE` | no |
| `FAILED` | no |

A criterion passes only when its latest records are all `MEASURED` at the current revision and at least one of them used the consumer's method. The current revision must also equal the frozen revision. `UNKNOWN` and `INCONCLUSIVE` never count as a pass, and tests never stand in for the consumer path.

`record_evidence` binds each record to `run.currentRevision`; the caller cannot choose the revision. `review`, `prototype`, and `tdd:` evidence come only from `record_review`, `record_prototype`, and `record_test`, so none of them can be forged through `record_evidence`.

## How evidence becomes stale

Each record declares `dependencies`: path globs (`*`, `**`, `?`), `node:<id>`, or `interface:<name>`.

Before every command, each surface compares `run.currentRevision` with Git `HEAD`. When `HEAD` moved, S50 applies `revision_changed` with the paths from `git diff --name-only --no-renames`, so a rename stales evidence on both the old and the new path. An `integrate_node` or `revision_changed` that names any revision other than `HEAD` is refused, so a caller cannot keep evidence current by naming a revision or passing an empty path list.

On a revision change:

1. For each claim, S50 takes its latest record.
2. If any changed path matches a dependency, S50 appends a `STALE` record that supersedes it.
3. If none match, S50 appends a copy at the new revision with the same state that supersedes it.
4. A record with no declared dependencies cannot show it is unaffected, so any changed path stales it.

On integration, S50 also stales the latest record of every claim that depends on `node:<id>` of the integrated node or on `interface:<name>` for an interface it defines.

Old records are never deleted. `evidence.jsonl` keeps the full history, and each new record names the one it supersedes.

`PR_READY` is a live predicate. After every command, if the run is in `PR_READY` and a blocker reappears (a revision change, a new finding, a `FAILED` measurement), the run moves back to `REVERIFY_STALE`. A pending human gate, such as merge authorization, pauses the predicate and keeps the gate.

## Review

`record_review` is accepted in `REVIEW` and in `REVERIFY_STALE`. It must cover every required dimension:

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

A web UI run adds the `frontend-design` contract review, `web-design-guidelines`, and `agent-browser` verification. It adds `vercel-react-best-practices` only on a React or Next.js run.

The review record depends on every path, so any later change stales it, and `PR_READY` needs a review at the current revision. Findings carry severity, trigger, consequence, evidence, revision, owner, and reviewer. The coordinator sets the revision, so a finding always names the revision that was reviewed. Reviewers record findings and do not patch; a patch is a new revision, which stales the review.

### What "independent review" means

A review is independent only when all three hold:

1. The host has independent agents. Inside Pi, a registered `subagent` or `Task` tool reports that.
2. The review says it ran in a fresh independent agent (`independent: true`).
3. The reviewer is not a graph node owner or the integration owner.

Otherwise the coordinator stores the review as reduced assurance with the reason. The label comes from these checks, not from the caller, and S50 never labels same-agent self-review as independent. S50 cannot see which agent wrote a review, so condition 2 is the agent's own report.

## Web guideline reproducibility

**Upstream fact.** `web-design-guidelines` fetches `https://raw.githubusercontent.com/vercel-labs/web-interface-guidelines/main/command.md` fresh on each run. Its rules can change between two reviews of the same code.

**S50 policy.** S50 does not modify the skill to pin the URL. The reviewer passes the fetched text as `guidelinesContent`. The coordinator never stores the text: it stores its sha256 and the locked commit of `web-design-guidelines` on the review record, which is bound to the application revision. It attaches the digest and commit to every finding at that revision, including findings recorded before the review.

## Consumer routes

| Consumer kind | Route | Evidence method | Without the capability |
| --- | --- | --- | --- |
| `browser`, `electron` | `agent_browser` | `browser` | `INCONCLUSIVE`: driver unavailable |
| `cli`, `tui` | `drive_executable` | `cli` | not applicable |
| `http`, `rpc` | `protocol_request` | `http` | not applicable |
| `library` | `public_api` | `library` | not applicable |
| `native` | `native_automation` | `native` | `INCONCLUSIVE`: native automation unavailable |

S50 never substitutes `agent-browser` for a consumer it cannot drive. When a route is unavailable, preflight records a risk, and the agent records `INCONCLUSIVE` evidence or applies `declare_inconclusive`. The run then cannot reach PR_READY until a real measurement arrives.

## Secrets

`apply` redacts every free-text string in a command before the command is decoded and stored. It keeps two kinds of string as given: identifiers that link one command to the next (ids, claims, owners, reviewers, revisions, paths, and skill names), because redacting them could merge two ids, and the fetched guideline text, which is hashed and never stored. Do not put secrets into identifiers. `startRun` redacts the objective, repository, consumer path, criteria, constraints, and non-goals the same way, so an evidence record's criterion still matches its run criterion. `applyPreflight` redacts every preflight fact, including the repository root and the remote URL. `redact` in `src/evidence/verification.ts` replaces bearer tokens, `Authorization:` headers, `sk-` keys, GitHub `ghp_`, `gho_`, `ghu_`, `ghs_`, and `ghr_` tokens, Slack `xoxb-` and `xoxp-` tokens, AWS `AKIA` key IDs, `password=` and `password:` values, JWTs, PEM private keys, and credentials inside URLs with `<REDACTED>`. Store references to environment variables or secure stores instead of values.

## Diagnostic-test exception

See [workflows.md](workflows.md#the-diagnostic-test-exception-bug).
