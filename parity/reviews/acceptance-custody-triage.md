# Draft acceptance verifier custody audit

This is an audit of supporting definition infrastructure. It is not a parity verdict or a product-level completion-gate fault injection.

## Reproduced finding

The original definitions and manifest are unchanged. Their hashes still match the acceptance owner's report.

A counterfactual copy under `parity/fixtures/acceptance-forged-freeze/` declares every definition FROZEN and supplies `implementation-owner`, `openai`, and `nonexistent-reference-run` as review metadata. The partition still declares `denominatorComplete` false.

The original verifier's `--write-hashes` operation exits with code 0 on that copy. A subsequent verification also exits with code 0 and prints FROZEN. See `../evidence/acceptance-forged-freeze-rehash.txt`, `../evidence/acceptance-forged-freeze-verification.txt`, and `../evidence/acceptance-custody-audit.txt`.

The parent can write the original definition file under the current OS permissions. A separate same-user checkout is not an external custody boundary. No files in that original checkout were altered by this audit.

## Root cause

`checkDefinitions` checks only that declared reviewer, model-family, and reference-run fields are truthy. It does not authenticate identities, bind executed reference runs, require distinct reviewer families, verify all configuration cells, or enforce a complete denominator for a frozen partition. Recomputing local hashes authenticates no producer.

The change protocol in the README is not enforced by the verifier. The README's no-write-access claim is contradicted by the observed permission check.

## Disposition

Fix the supporting verifier and its claims through the independent acceptance-owner role. Keep all definitions DRAFT and their behavioral expectations unchanged. No source requirement, configuration value, exact string, or forbidden effect may be weakened to repair this infrastructure.

Until authenticated external custody and execution provenance exist, the tool must distinguish structural validation from authorized review or freezing. It must reject unsupported promotion rather than present a declared promotion as verified.

The eventual full completion gate must remain separately audited and authenticate all conjunctive acceptance obligations. These supporting tests cannot substitute for its required six product-level fault injections.
