## Problem

**Candidate A: direct linked-manifest validation over immutable, content-addressed run artifacts.** This is a read-only design, not a completion claim.

The draft manifests already describe an incomplete oracle: four requirements, incomplete dependency discovery, no independent acceptance owner, unfrozen definitions, and no accepted paired runs. The 164 pstack and 29 cursor-team-kit files are inventory seeds—not the behavioral denominator. Baseline is exactly `78dd5a04279436ebf6dde44853bacdab88ca9ae0`; official plugin source is exactly `ccb5507cec1546dc88135c1139c811e6c59115ba`.

**Grounding limitation:** I read the architect skill and all three requested references completely, plus the five named parity files. I located the initiating user message, but the read tool rejected its single 56.3 KB line; the available tools cannot extract a subsection of that line. Consequently, this candidate is grounded in this request and the draft manifests, **not a verified reading of the full eleven-section contract**. Contract extraction and reconciliation remain blocking prerequisites.

## Usage (caller’s view)

One operation evaluates a delivery against independently approved acceptance definitions; callers do not coordinate validation stages or supply passing statuses.

Illustrative call sites—not implemented APIs:

```ts
// Supporting scaffold: useful diagnostics, never completion.
const report = await evaluateCompletion(draftDelivery, acceptanceAuthority);
// => blocked: incomplete oracle, unresolved closure, missing executions, ...

// Release automation: exact payload and sealed runs, not “current checkout.”
const report = await evaluateCompletion(sealedDelivery, acceptanceAuthority);
if (report.kind !== "accepted") stopRelease(report.blockers);

// Independent auditor: replay the same immutable inputs.
const reproduced = await evaluateCompletion(sealedDelivery, acceptanceAuthority);
```

`draftDelivery` and `sealedDelivery` identify immutable manifest roots. The authority comes from protected configuration outside implementation-controlled manifests. Successful evaluation returns a certificate bound to the precise delivery, oracle, evidence, and reviewer attestations.

There is no `markRequirementPassed`, `skipScenario`, or caller-supplied verdict.

## Shape

### Records and dominant access patterns

A **delivery manifest** directly links content-addressed records:

| Record | Load-bearing content |
|---|---|
| Source lock | Exact revisions; distribution and runtime hashes; retrieved-byte integrity; reference environment |
| Dependency closure | Nodes, source-located edges, resolved resources, complete inventories, independent closure audit |
| Source dispositions | Every inventoried resource mapped to requirements or an independently reviewed nonbehavioral disposition |
| Acceptance oracle | Initiating contract digest; requirements; configurations; scenario obligations; test definitions; review policy |
| Candidate payload | Installable bytes, complete component digests, dependency/environment lock, clean-install receipt |
| Scenario definition | Requirement links, configuration, fixture digest, ordered semantic actions, assertions, required recordings |
| Paired run | Reference and Pi execution receipts, actual model/tool identities, fixture/action bindings, recordings, observations |
| Comparison | Raw evidence links, protected comparator version, audited normalization policy, mismatches |
| Independent review | Subject digests, scope, reviewer identity, approval or unresolved findings |

The gate walks the manifest links directly and builds ephemeral ID maps and reverse coverage indexes. There is no second editable coverage ledger. Missing, duplicate, dangling, or contradictory links fail validation. Expected test and scenario obligations come from the frozen oracle—not from whichever runs happen to exist.

Content addressing uses a specified canonical encoding for records and hashes raw artifact bytes separately. A digest proves byte identity, **not authenticity or correctness**.

### Type and signature sketch

```ts
type CompletionReport =
  | { kind: "blocked"; blockers: readonly Blocker[] }
  | { kind: "rejected"; findings: readonly Finding[] }
  | { kind: "accepted"; certificate: AcceptanceCertificate };

evaluateCompletion(
  delivery: DeliveryHandle,
  authority: AcceptanceAuthority
): Promise<CompletionReport>; // not implemented
```

`DeliveryHandle` is an opaque reference to a root. `AcceptanceAuthority` identifies protected definition roots, trusted runner identities, independent reviewer identities, and separation-of-duty policy. Neither is a public JSON transport type.

Private validated domain types distinguish `ApprovedOracle`, `AuthenticExecutedPair`, and `ReviewedComparison` from untrusted input. These types have no public constructors; acceptance certificates are issued only by the gate after all obligations succeed. Runtime checks remain necessary at every external boundary.

### Ownership and module map

- **`parity-gate`** owns manifest interpretation, coverage obligations, and certificate issuance. One public evaluation operation hides graph validation, provenance checking, completeness joins, and verdict derivation.
- **Runner** owns execution receipts and immutable capture objects; it cannot approve definitions or comparisons.
- **Independent acceptance owner** owns reviewed, hashed, protected definitions before candidate acceptance execution. Definition changes create a new oracle root and require reapproval.
- **Independent reviewers** own closure, normalization, behavioral comparison, and final acceptance attestations within explicitly assigned scopes.
- **Implementation owner** owns candidate bytes and proposed mappings, never acceptance approval.
- **Artifact store** owns immutable blobs, not mutable requirement statuses.

Private gate files are organized by invariant ownership—definitions, execution evidence, verdict—not as pass-through load/validate/save stages. Per-actor immutable outputs merge at the read boundary; no shared writable evidence ledger.

### State machines and failure behavior

**Oracle:** `draft → independently reviewed → protected/frozen`. A changed definition creates a new draft; it does not mutate an approved oracle.

**Execution:** `planned → started → finished → sealed`. A finished receipt must contain actual execution outcomes, including failed assertions. Interrupted or partially uploaded runs remain unusable. Sealing never means passing.

**Delivery:** `unassessed → blocked/rejected/accepted`, derived afresh from immutable inputs. There is no editable success transition.

The evaluator rejects or blocks:

- Empty inventory, incomplete recursive closure, unresolved references, or unmapped sources.
- Missing required configurations/scenarios, unresolved working-integration prerequisites, or incomplete platform obligations.
- Missing tests, unexecuted tests, failed tests, invented test IDs, or manually asserted requirement status.
- Missing reference or Pi side, incomplete recordings, missing action timestamps, or mismatched fixture/action bindings.
- Stale candidate/component hashes, incorrect installed payloads, unbound runtime dependencies, or evidence from another oracle.
- Unapproved normalization, unresolved reviews, rejected comparisons, or any unresolved mismatch.
- Forged receipts or approvals; a JSON `"passed": true` has no authority.

Paired journeys use the same frozen semantic action plan and fixtures, with explicitly approved host-specific input mappings. Normalization operates only through reviewed rules and preserves raw recordings. Distinct negative service-availability cases cannot substitute for successful live integration coverage.

The gate is repeatable and crash-safe: immutable inputs yield the same decision; certificates publish atomically only after verification. Early scaffolding returns blockers only. **No `completion.json` PASS exists until authentic acceptance execution and independent approval are available.**

### Trust limits

The gate cannot establish behavioral truth from supplied JSON—even perfectly consistent JSON. Trusted runners must attest actual execution, bound to the oracle, payload, environment, recordings, and run identity. Independent reviewers must assess source completeness and the adequacy of observations and comparisons.

Protection must be external to the implementation agent’s write authority: hashing definitions in an editable file is insufficient. Runner signatures are likewise insufficient if the implementation owner controls the signing identity or capture environment. Compromised runners, colluding reviewers, and an incomplete oracle remain explicit trust risks; fresh independent reruns and raw-evidence review reduce, but do not eliminate, them.

## Synthesis decision

Candidate A proposes linked-manifest validation as the base; cross-candidate synthesis belongs to the parent. No other candidate has been incorporated. Inherit-parent runners provide **design diversity**, not demonstrated model-family diversity.

Red-flag screen: one evaluation entry point, one verdict owner, private schemas, no caller-controlled stages, and no hand-maintained duplicate coverage list.

## Tradeoffs accepted

- We accept complete graph traversal in exchange for a directly auditable decision without synchronized evidence indexes.
- We accept artifact storage and rerun costs in exchange for immutable, payload-specific evidence.
- We accept independent approval overhead in exchange for preventing implementer-authored acceptance shortcuts.
- We accept blocked delivery during unavailable reference usage in exchange for preserving successful paired-journey obligations.

## Alternatives considered

- **Event-sourced evidence service:** hides submission history and sequencing, but introduces replay policy, materialized views, and service ownership. Callers must understand evidence commands and run lifecycle. It is deeper operationally but less direct for this local, uncommitted grounding.
- **Generated checklist/status ledger:** simple for callers, but exposes manual synchronization and lets status replace evidence. Rejected because it cannot safely own completeness or behavioral acceptance.
- **Runner-owned acceptance:** hides execution and verdict behind one interface, but combines evidence production with approval. Rejected despite interface depth because it violates independent acceptance ownership.

## Open questions and risks

- How will the initiating eleven-section contract be extracted and reconciled into independently approved obligations before freezing the oracle?
- Which protected mechanism will keep acceptance definitions, reviewer credentials, and runner attestations outside implementation-owner control?
- Which independent owners will approve closure, normalization, behavioral comparisons, and final acceptance?
- How will reference service access and required supported-platform environments be restored without weakening coverage?
- What capture and isolation guarantees are necessary to make authentic runner provenance credible?

## Next implementation step

Build the fail-closed linked-manifest validator with adversarial omission/forgery fixtures and an explicit “oracle unavailable” blocker, while independently extracting and approving the complete acceptance oracle; do not implement a success-emitting path yet.