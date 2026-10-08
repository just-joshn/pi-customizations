## Problem

Candidate B proposes an **append-only, content-addressed execution event index with a derived acceptance view**. Completion is a replayed conclusion, never a writable requirement status or a collection of manually linked “passing” manifests.

Grounding: `parity/source-lock.json`, `dependencies.json`, `requirements.json`, `configurations.json`, and `progress.md` currently describe incomplete discovery, four draft requirements, no acceptance owner, unfrozen definitions, unmatched model configurations, and no accepted paired execution. Source is pinned to `ccb5507cec1546dc88135c1139c811e6c59115ba`; implementation baseline is `78dd5a04279436ebf6dde44853bacdab88ca9ae0`. Neither establishes parity.

**Grounding limitation:** I located only the initiating user message in the specified parent transcript, but the read tool refused its single 56.3 KB line because it exceeds the 50 KB limit. I therefore cannot claim to have extracted or verified the complete eleven-section contract. Importing that exact contract and independently validating its interpretation is a mandatory blocking prerequisite below. No other session was inspected; no files were modified.

## Usage (caller’s view)

Illustrative API sketches—not implemented code:

```typescript
// Acceptance owner: approve the complete oracle, separately from implementers.
const epoch = await acceptance.freeze(reviewedDefinitionProposal);

// Runner: execute a protected scenario; callers cannot submit a “passed” result.
const attempt = await evidence.execute(epoch, "mode-sticky", "installed-user");

// Release coordinator: obtain the sole authoritative completion decision.
const verdict = await acceptance.evaluate(epoch, candidateArtifact);
```

`freeze` rejects incomplete inventory, closure, source dispositions, configuration coverage, scenarios, tests, normalization rules, or ownership. `execute` runs both reference and candidate through controlled runner adapters and records authenticated observations. `evaluate` replays admitted events, checks artifact freshness and independently approved comparisons, and returns `BLOCKED`, `FAIL`, or an executed acceptance receipt.

The current draft inputs must produce **BLOCKED**, with explicit reasons—not a percentage, not partial success, and not `completion.json` containing PASS.

## Shape

### Records and dominant access patterns

Private storage records are immutable and addressed by their canonical content hash:

| Record | Essential contents |
|---|---|
| Definition epoch | Exact initiating-contract digest; source lock; nonempty distribution inventory; audited recursive closure; source dispositions; requirements; complete configuration/scenario obligations; acceptance-test definitions; normalization policies; runner policy; owner approvals |
| Execution event | Producer identity, producer sequence, predecessor hash, event kind, epoch digest, attempt identity, referenced content digests, authenticated provenance |
| Execution observations | Side, actual artifact/component digests, host/environment and model identities, configuration, starting fixture digest, ordered action digest, timestamps, recordings, outputs and side effects |
| Comparison result | Both execution digests, comparator/test-definition digest, executed assertions, original observations, normalized observations, normalization-policy digest, mismatches |
| Review decision | Reviewer identity and authority, exact reviewed digests, decision, findings, resolution links |
| Acceptance receipt | Epoch, sealed event-index root, candidate payload digest, gate version, executed acceptance result, independent approvals |

No event kind means “requirement manually passed.” Existing `status`, `evidence`, `readingComplete`, and similar draft fields are discovery inputs, not authority.

Derived indexes serve three primary queries:

1. **Coverage:** epoch obligation → authenticated paired attempts → executed comparisons → independent review.
2. **Freshness:** candidate artifact/component digest → all supporting executions and reviews.
3. **Closure:** locked source item/dependency → audited disposition → requirements and applicable obligations.

A disposable materialized view accelerates these queries; replay remains authoritative. Counts and coverage denominators derive from the frozen definitions, never from observed successes.

### Ownership and modules

- **Acceptance authority:** owns protected definitions, completeness review, normalization approval and final evaluation. Implementation actors cannot change these definitions or authorize acceptance.
- **Evidence engine:** owns runner admission, immutable event storage and replay-derived views. Runner identities have narrowly scoped append authority, not acceptance authority.
- **Implementation owner:** produces candidate payloads and requests executions; cannot manufacture accepted observations or reviews.
- **Independent reviewers:** approve exact definition and evidence digests; substantive unresolved findings block completion.

Use per-producer append-only chains with immutable content blobs, merging at the read boundary rather than sharing a writable journal. Seal the admitted producer heads into a hashed index root for each evaluation. Detect forks, missing predecessors and unauthorized producers; do not silently select one branch. A controlled execution service also tracks dispatched attempts so omitting an unfavorable attempt cannot produce acceptance.

This follows separate-before-serializing-shared-state and single-source-of-truth discipline. Storage schemas remain private; callers receive domain handles and diagnostic verdicts, per boundary-discipline.

### Signatures

```typescript
freeze(proposal: DefinitionProposal): Promise<FrozenEpoch>
execute(epoch: FrozenEpoch, scenario: ScenarioId,
        configuration: ConfigurationId): Promise<AttemptHandle>
evaluate(epoch: FrozenEpoch,
         candidate: CandidateArtifact): Promise<CompletionVerdict>
```

These are the entire ordinary caller surface. Trusted runner and reviewer adapters authenticate internal records; there is no public `appendPass`, `markRequirement`, or caller-supplied trusted execution JSON API.

The interface hides pair coordination, provenance checks, content storage, replay, closure joins, freshness checks and acceptance policy. Callers expose only the intended scenario/configuration and candidate artifact—not internal validation stages.

### State machines

**Definitions:**  
`Draft → Independently reviewed → Frozen`  
A changed definition creates a new epoch. It cannot edit the old epoch or automatically inherit its acceptance.

**Attempt:**  
`Dispatched → Started → Captured → Compared → Reviewed`  
Both sides must independently reach captured execution. Cancellation, runner failure, missing events or absent recordings remain nonaccepting. Retrying creates a new attempt, preserving the failed history.

**Completion:**  
`Blocked → Eligible for executed acceptance → PASS | FAIL`  
Eligibility is not success. PASS requires the protected acceptance suite actually to execute against the sealed evidence snapshot and exact candidate payload, with required independent approvals.

Repeated ingestion of the same authenticated content is idempotent. Partial writes and crashes leave incomplete attempts, not implicit success.

### Fail-closed acceptance rules

The evaluator blocks or fails on:

- Empty inventory; incomplete recursive dependency closure; unresolved resources or unmapped source items.
- Absent supported configurations or scenarios; unknown applicability; incomplete obligation denominator.
- Missing acceptance tests, tests never executed, or caller-forged status fields.
- Missing reference or candidate side; unauthenticated runner provenance.
- Stale candidate, reference, host, component, fixture, action, test-definition or configuration digests.
- Missing required recordings or incomplete action/timing capture.
- Different fixtures/actions across paired runs without an independently approved equivalence definition.
- Unapproved or unaudited normalization, including removal of meaningful behavioral differences.
- Unresolved reviews, contradictory evidence, outstanding mismatches or incomplete executed acceptance.

The Windows journey, live integrations and working-service coverage cannot disappear because they are currently unavailable. The Cursor usage limit remains a blocked prerequisite; an unavailable-service negative test does not replace successful model-backed journeys. The installed-user Cursor/Pi budget mismatch must be resolved and actual model identities recorded before those comparisons count.

**Trust limit:** hashes establish identity and tamper evidence, not behavioral truth. Authentication proves which trusted producer emitted a record, not that an arbitrary runner or reviewer is honest. The design therefore requires controlled runner execution, authenticated capture, protected definitions, independent observation/review and a defined trusted execution boundary. Supplied JSON alone can never establish parity. Compromised runners, colluding reviewers and an incomplete oracle remain explicit residual risks.

## Synthesis decision

Candidate B is submitted for comparison, not selected as the synthesis winner. Its distinguishing feature is that acceptance derives from replayed execution history under a protected definition epoch; it does not validate a directly curated graph of requirement-to-evidence manifests.

This is local design exploration because the draft grounding is uncommitted in the parent workspace. The inherited-parent runner setting supplies design diversity, **not demonstrated model-family diversity**.

## Tradeoffs accepted

- We accept event replay and producer-authentication complexity in exchange for immutable history and resistance to manually curated success.
- We accept disposable derived indexes in exchange for one authoritative event history rather than synchronized requirement statuses.
- We accept conservative invalidation after definition or artifact changes in exchange for avoiding stale acceptance.
- We accept blocked delivery when authentic reference execution is unavailable in exchange for refusing synthetic parity claims.

## Alternatives considered

- **Direct linked-manifest validation:** offers a similarly small evaluator interface and simpler storage, but curators must maintain the correct requirement/evidence graph and distinguish genuine execution from declarations. It loses here because authoritative execution history and omissions are less structurally visible.
- **Mutable requirements database:** makes dashboards easy, but exposes status transitions and synchronization rules to writers. It hides queries while leaking acceptance ownership; a local “mark passed” operation can become global truth.
- **CI exit-code gate alone:** hides execution behind one command, but does not itself prove complete source/configuration coverage, protected oracle ownership, paired capture or evidence freshness. It is useful as an execution environment, not the acceptance model.

## Open questions and risks

- Which separately controlled identities will own acceptance definitions and independent reviews, and how will their authority be enforced outside editable repository JSON?
- How will the exact eleven-section initiating contract be extracted and its complete interpretation independently approved?
- What controlled runner boundary can authenticate real Cursor/Pi execution and prevent selective omission of failed attempts?
- Which model-dependent differences may be normalized without concealing user-visible failures?

## Next implementation step

Build a **fail-closed scaffold and adversarial omission tests** that always refuse completion until the exact contract, independently owned protected oracle, authenticated paired runner and executed acceptance suite exist; it must never emit `completion.json` PASS from draft records or manually asserted statuses.