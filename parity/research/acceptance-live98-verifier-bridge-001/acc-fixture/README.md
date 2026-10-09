# Acceptance definitions

Status: DRAFT. Nothing here is reviewed or frozen. Nothing here certifies parity.

This directory holds the independent acceptance definitions for pstack user-visible parity. The first partition covers `/setup-pstack`. The implementation owner should read these files and should not edit them. Nothing in software or the operating system enforces that today. See Custody.

## Ownership and identity

The independent acceptance owner writes this directory and nothing else. The implementation owner works in a separate checkout and should propose changes through `proposals/`. That is a procedure, not a control.

The definitions were written by a Pi task whose harness reported `claude-opus-5-5` through provider `claude-subscription` at reasoning level `high`. The verifier repair in this revision ran under the same reported identity. That identity is runtime metadata from `PI_MODEL`, `PI_PROVIDER`, `PI_REASONING_LEVEL` and the session's `model_change` entry. It is not an authenticated attestation of the physical model that served the requests. `governance.json` records the implementation owner as `openai/gpt-6.1-sol`. That value comes from the brief and nobody here observed or authenticated it.

## Layout

- `setup-pstack/definitions.json` holds one record per independently falsifiable setup behavior. Each record cites source excerpts with line locators, names its configuration matrix, its actions and expectations, its required and forbidden effects, any host translation it needs and its open questions.
- `setup-pstack/configurations.json` holds the configuration axes, the baseline and fixture descriptions that the matrices refer to.
- `governance.json` names the implementation owner's id and model family. The verifier rejects any other field, so an `authority` or `approved` field cannot appear here.
- `setup-pstack/record-hashes.json` is generated. It holds the sha256 of each definition record, of the partition metadata, of each configuration value, of the remaining configuration metadata and of `governance.json`, each in key-sorted JSON.
- `review/parent-drafts-review.md` reviews the parent's draft ledgers and lists findings that need correction.
- `review/selftest-red-original-verifier.txt` is the current self-test run against the original verifier. It failed 20 checks.
- `open-queue.json` keeps every setup-adjacent requirement that is not yet defined.
- `CHECKPOINT.md` is the owner's continuation note.
- `tools/verify-acceptance.mjs` is the structural checker.
- `tools/selftest.sh` injects faults into a copy and confirms the checker rejects each one.
- `MANIFEST.sha256` is generated. It holds the sha256 of every other file here.

## Known source contracts versus unobserved runtime controls

Each record carries a `basis` list. `source-explicit` and `source-inferred` mean the expectation comes from text in the locked pstack revision `ccb5507cec1546dc88135c1139c811e6c59115ba`. `reference-observed-once` means one preliminary Cursor capture exists. `unobserved-runtime-control` means the behavior belongs to the Cursor host or model at run time and no capture exists.

In Cursor, setup is a model-executed skill. So even a `source-explicit` expectation has no observed reference realization yet. The only reference captures are the slash menu, the two-Enter submission and the `included_usage` failure. The failure covers ACC-SETUP-004 only. It is not a successful setup and does not count toward any other definition.

## Checking

```bash
node parity/acceptance/tools/verify-acceptance.mjs \
  --reference-root <parity>/reference/cursor-plugins \
  --parity-root <parity> \
  [--expect-manifest-sha256 <sha256 held outside this directory>]
bash parity/acceptance/tools/selftest.sh <parity>/reference/cursor-plugins <parity>
```

The verifier is a structural checker for DRAFT integrity. It fails when:

- the reference checkout is not at the locked revision, a cited source hash drifts, or an excerpt is not verbatim inside its line locator;
- cited evidence drifts, or a matrix names an unknown configuration;
- any record or the partition claims REVIEWED or FROZEN, or carries review metadata;
- a recorded definition, partition field, configuration value or governance field changed or disappeared;
- `governance.json` has a field other than the implementation owner;
- any file here differs from the manifest;
- a supplied `--expect-manifest-sha256` differs from the manifest's sha256.

A claimed promotion also gets specific findings. These cover fewer than two reviewers, a reviewer who is the implementation owner or shares its family, reviewers who share a family, missing reference runs, every cited run (because no run registry exists), and FROZEN with an incomplete denominator. These findings explain the claim. They are not an approval path. The verifier rejects every promotion because no authenticated review or freeze transition exists.

On success it prints one JSON object with `structural` set to `PASS` and `authorization` set to `NONE`. `openBlockers` lists the standing gaps: no authenticated transition authority, no reference-run registry, no external custody, the incomplete denominator, the absent final acceptance gate and, when no pin was given, the absent external pin. A structural pass says the DRAFT files agree with each other and with the locked source. It does not say any expectation is true, reviewed or frozen, and it is not an acceptance verdict.

`--write-hashes` records hashes for new entries and rewrites the manifest. It refuses when any check above fails. It also refuses to change or drop any entry that was already recorded. So the tool cannot rebless a weakened, deleted or promoted record. It can still rebless a prose or tool edit, and it cannot detect a hand edit of `record-hashes.json` itself. Only a comparison against a manifest digest held outside this directory catches those. The self-test shows both cases.

The verifier checks the directory it reads, including its own file. A forger who can write here can also replace the verifier. A party that relies on the result should run its own pinned copy of the verifier and pass its own pinned manifest digest.

## Change protocol

This protocol is procedural. No software or OS control enforces steps 1 to 3 today.

1. Anyone may propose a change by adding a file under `proposals/` that names the record id, the exact before and after, and the evidence. Evidence is a verbatim excerpt from the locked source or a linked successful Cursor reference run with its recording.
2. An acceptance owner who is not the implementation owner and runs on a different model family from it reviews the proposal. A second acceptance reviewer on another family is required before any record moves from DRAFT to REVIEWED.
3. A proposal may not delete a record, remove a configuration value, relax an exact string to a rubric, or drop a forbidden effect unless reference evidence shows the original expectation is wrong. Lack of a reference run is never that evidence.
4. Adding a new DRAFT record or configuration value is the only definition change the local tool records. Changing or removing a recorded entry needs an authenticated transition, and none exists. The accepting owner runs `verify-acceptance.mjs --write-hashes`, runs the self-test, appends a line to `CHANGELOG.md` and reports the new manifest sha256 to whoever holds the external pin. The changelog cannot carry the manifest hash because the manifest covers the changelog.

## Status lifecycle

- DRAFT. Source-grounded or observation-grounded, unreviewed. Verdicts against a DRAFT record can only be `unverified`.
- REVIEWED. Two independent acceptance reviewers on different model families agreed, through an authenticated review record. No such record exists yet.
- FROZEN. REVIEWED, plus at least one authenticated successful reference run per configuration cell, with repeat-run variation captured where the behavior is model-produced. No run registry exists yet.

The verifier rejects REVIEWED, FROZEN, a partition status other than DRAFT, `frozen: true` and any `review` object, whatever the metadata says. A reviewer name, a model family, a run id or an approval line is a declaration, not an authentication. The partition may become frozen only after every record is FROZEN and `denominatorComplete` is true. Today both are false, and that transition also needs the missing authority.

## Evidence invalidation

Each candidate or reference evidence record must cite the definition id, its record hash from `record-hashes.json` and the manifest sha256. When a record hash changes, every evidence item bound to the old hash is stale and its verdict returns to `unverified`. When the manifest changes for a reason outside a record, such as a configuration fixture, every record whose matrix names an affected configuration value is stale. A change to the locked reference revision or a cited source hash makes every record that cites that source stale until it is re-reviewed.

## Custody

The implementation owner can write this directory. Both owners run as the same OS user. The parent's permission check in `parity/evidence/acceptance-custody-audit.txt` found the original definitions file writable by the parent. A separate worktree and branch keep casual edits apart. They are not a custody boundary. Role instructions create no OS protection.

Hashes prove identity, not truth. A matching hash shows a file is the one that was recorded. It does not show who recorded it, whether review happened, or whether a cited run exists.

The parent ledger should hold the current manifest sha256 outside this directory and pass it as `--expect-manifest-sha256`. That catches any rebless after the pin was taken. It does not protect the pin itself, because the parent ledger is also writable by the implementation owner.

These prerequisites remain open and this directory cannot supply them:

- external custody that the implementation owner cannot write, such as a separately owned repository, a protected branch with required review, or a signing key the implementation owner does not hold;
- authenticated review records that bind a reviewer's actual provider and model to a record hash;
- an authenticated registry of successful reference runs per configuration cell;
- the full final acceptance gate, which must authenticate every conjunctive acceptance obligation and pass its own product-level fault injections.
