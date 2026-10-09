# Architect gate cross-judge review

This is a read-only design review. It is not source-closure certification and not runtime acceptance.

## Runtime identity

- **This reviewer.** None of my tools report the provider or model I am running on, so I record it as unobserved. I am not inferring it from labels. If I run on the parent's model, this review is not independent across model families.
- **Parent.** The parent says it runs `openai/gpt-6.1-sol`. I did not verify that. `progress.md` also leaves the acceptance-owner child's identity unverified.
- **Candidates.** Both candidates say they inherited the parent model. That gives design diversity only.

## What I read

- **Read in full:** `designs/gate-a.md`, `designs/gate-b.md`, `contract.md` (lines 1–437, read in two parts), `source-lock.json`, `dependencies.json`, `requirements.json`, `configurations.json`, `mismatches.json`, `progress.md`, `decisions.tsv` and `scenarios/setup-budget-labels.json`.
- **Partly read:** `extensions/pi-pstack/scripts/check-native-parity.mjs`, lines 1–80.
- **Not checked:** I could not recompute the contract SHA-256 that `progress.md` records (`ffb662…`), because I have no shell.

## Scores (0–5)

| Criterion | A: linked manifests | B: append-only event index |
|---|---|---|
| 1. Fail-closed on incomplete or fabricated evidence | 4 | 5 |
| 2. Independent ownership, custody and trust limits | 3 | 4 |
| 3. Pair, configuration and component freshness, plus all-attempt retention | 2 | 4 |
| 4. Smallest public interface, single owner | 4 | 3 |
| 5. Diagnostic usefulness without false completion or a duplicate runtime | 4 | 3 |
| **Total** | **17** | **19** |

### Reasons

1. **Fail-closed.** Both designs reject forged statuses and caller-supplied verdicts. B also detects forks, missing predecessors, unauthorized producers and attempts that were dispatched but never reported.
   - A has a hole. A curated manifest can leave out an unfavorable run, and A's own critique of B admits that omissions are "less structurally visible" in a manifest graph.
2. **Ownership and custody.** Both designs state honest trust limits: a hash proves identity, not truth. Neither defines the custody mechanism.
   - A's `evaluateCompletion(delivery, authority)` lets the caller pass in the authority. An implementer could build their own.
   - B's per-producer chains with scoped append rights are the stronger custody model.
3. **Freshness and attempt retention.** B keeps failed attempts as history and invalidates conservatively. A does not retain all attempts.
   - Both miss several contract items. See issue 2 below.
4. **Interface.** A has one entry point and private schemas.
   - B exposes `freeze`, `execute` and `evaluate` on one surface. That puts the runner and the definition authority behind the gate's API, which contradicts B's own module separation.
   - B also brings in an event store, a materialized view and producer sequence numbers before any real paired run exists.
5. **Diagnostics.** A's early version returns only specific blockers.
   - B's next step is a scaffold that "always refuse[s] completion". That is the uninformative always-reject gate.

## Recommendation

**Base on A, with these grafts from B:**

1. **Per-producer, append-only attempt records with dispatch tracking.** The gate checks dispatched attempts against reported ones, so an omitted failure blocks. Retries create new attempts, and failures stay in history.
2. **Definition epochs.** Changing a definition creates a new oracle root that gets no inherited acceptance.
3. **Fork and missing-predecessor detection,** plus a sealed evidence-root digest in the certificate.
4. **"Eligible" is not PASS.** PASS requires the protected acceptance suite to actually run against the exact final package and deployment manifest from a clean install (contract §9 final paragraph, §11).
5. **B's three derived queries:** coverage, freshness and closure. Build them as throwaway in-memory indexes, with no materialized view.

**Reject from B:**
- `execute` on the gate's surface. The runner is its own module.
- The persistent materialized view.

**Change in A:**
- Load the acceptance authority from a pinned, reviewed location. The caller should not pass it in.

## Contract grounding, reconciled

Both candidates said they could not read the full contract. That limit is gone now that `contract.md` exists. Reading it shows obligations that **both** designs omit. These are gate requirements in their own right, and none may be waived:

1. **`completion.json` fields (§11).** It must record the Cursor reference, Pi version, source revisions, candidate revision, package digest, deployment manifest digest, acceptance-definition hashes, configuration matrix, requirement count, executed journey count, evidence index and verdict. Neither certificate lists the deployment manifest digest, the counts or the versions.
2. **Deployment manifest (§8).** It pins worker images, services, schedulers, adapters and config identities. If any component changes, the evidence is stale.
3. **Held-out corpus (§8).** An independent verifier keeps an undisclosed corpus and runs it only after the candidate digest is frozen.
4. **Repeat protocol (§8).** Model- and timing-dependent journeys need a declared repeat protocol, with every attempt kept. Rerunning until one attempt passes is forbidden.
5. **Feel and performance comparisons (§8).** Rules for action count, time to first feedback, cancellation response and similar measures must be set from reference evidence *before* the candidate is evaluated.
6. **Blinded evaluators (§8, §9).** Evaluators should not know which side produced which evidence, where practical. A failed assertion overrides a favorable opinion.
7. **Reviewer model diversity (§9).** Review attestations must record the actual provider and model. The gate must check the diversity the source requires.
8. **Cursor-free candidate environment (§6).** The gate needs proof that the candidate ran with no Cursor installed, with process launches and network calls observed.
9. **Gate self-test (§9).** Inject six product-level faults into an isolated candidate: missing command, wrong default, lost approval, fake worker, broken persistence and stale evidence. The gate must catch each one. Then remove the faults and reverify. Fixtures that only alter manifests do not satisfy this.
10. **Full requirement × configuration matrix (§9).** For example, `PSTACK-MODE-STICKY-001` requires the `windows` configuration, and that configuration has `environment: null`.

## Other source-grounded issues

- **Legacy gates.** `check-native-parity.mjs` already exists and trusts clause `verdict` fields written by hand. It also has an `--allow-external` waiver (lines 50–53), which contradicts §1 ("waived tests… cannot pass"). `check-subagent-parity.mjs` sits beside it. Neither design plans to migrate or delete these, so the repo would have two gate owners.
- **Custody is local only.** The acceptance owner works in `/tmp/pi-pstack-parity-acceptance-owner` on a branch, under the same OS user as the implementer. A branch is not custody. The gate must report a lasting blocker for this until an external protection exists.
- **Contract custody.** `contract.md` sits in implementer-writable `parity/`, and its digest is recorded only as prose in `progress.md`. The file also starts with a `poteto-mode` skill block and "create goal for:". The independent owner should confirm it matches the original message, and the oracle should pin the digest. I have not checked that match.
- **Who owns the gate code.** §4 requires hashing the runner and the comparison rules. The final gate's code therefore belongs inside the reviewed oracle, not under the implementer's sole ownership.

## Decision: preflight diagnoser first

**Yes. Build a truthful preflight diagnoser first, not an always-reject gate.** Two reasons:

- An always-reject gate tells you nothing.
- Its adversarial tests would pass vacuously, because a constant output fails every input.

The diagnoser's rules:
- Its result type has **no `accepted` variant**. It always exits non-zero.
- It never writes `parity/completion.json`.
- It is labeled preflight, so nobody can mistake it for the §9 gate.
- The full gate is still required. It adds the success path only once custody, a frozen oracle, an authenticated runner and the executed suite all exist.

## Next minimal slice

Build the preflight diagnoser outside the shipped package payload. It reads the current `parity/*` files read-only and prints blockers, each with a stable code and a source locator. It should report:

1. **Source lock.**
   - `status: incomplete`, `completeDependencyClosure: false` and `referenceConfigurationCaptured: false`.
   - Recomputed inventory and file hashes compared against `distribution-sha256.txt`.
2. **Closure.**
   - `closureAudited: false` and nodes with `readingComplete: false`.
   - Non-empty `unresolvedReferences` and edges marked `unresolved` or `unverified`.
   - Inventory files with no disposition.
3. **Requirements.**
   - Owner `null`, not frozen, and denominator incomplete.
   - Source `sha256` recomputed against the reference checkout.
   - Scenario IDs with no file. `mode-one-message`, `mode-sticky` and `setup-model-discovery` have none.
   - Configuration IDs that don't resolve.
   - Matrix cells. Today there are 9 requirement × configuration cells and 0 executed.
4. **Scenarios.** `fixture.digest: null`, `oracleFrozen: false` and `pairId: null`.
5. **Configurations and mismatches.**
   - The open `cursor-included-usage` prerequisite.
   - The `installed-user` budget mismatch.
   - Open `SETUP-BUDGET-UNLIMITED-LABEL`.
6. **Custody.**
   - No external authority.
   - The contract digest is not pinned by the independent owner.
   - Contract §8, §9 and §11 obligations not yet mapped to gate checks.
7. **Hand-written claims.** Any hand-written `status: passed` or `verdict` field is reported as an unsupported evidence claim and never counted.

**Tests.** Write one fixture per defect and assert the exact blocker code. Add a fixture that is complete apart from one defect, and assert that it produces only that defect's blocker plus the lasting custody and success-path blockers. Assert that the output type cannot represent acceptance.

**Afterwards.** Once the diagnoser reports correctly, migrate or delete the two legacy `check-*-parity.mjs` gates and the `--allow-external` waiver. Then hand the gate obligation list to the acceptance owner to freeze.