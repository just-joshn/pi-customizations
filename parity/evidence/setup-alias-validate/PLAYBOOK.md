# Setup alias + validate capture playbook

Designed under figure-it-out for brief `u-journey-setup-alias-validate`.

## Done predicate

Paired Cursor+Pi evidence under this directory with attempt IDs, covering:

1. `PSTACK-SETUP-ALIAS-ALWAYS-VALID-001`. `inherit-parent` and/or `auto` accepted without needing to appear in the detected real-slug set.
2. `PSTACK-SETUP-VALIDATE-001`. Every real slug written is in the detected set; an unavailable real slug stops the write and re-asks; aliases always pass.

Fail honestly when a host cannot show the oracle. Do not invent detected-model sets.

## Rigor

High on evidence honesty. Medium on harness novelty. Reuse `journey-helpers.mjs` and the setup-rerun capture shape.

## Units

1. Seed a mixed alias fixture (`inherit-parent` + `auto`) from the locked reference digest.
2. Drive `/setup-pstack` on Cursor with an instruction that keeps aliases and asks for one unavailable real slug on `bug-fix`.
3. Drive the same on Pi.
4. Score screens and rule bytes for alias acceptance, unavailable-slug stop, and no forbidden persist.
5. Write pair JSON + report.

## Lever

`parity/scripts/capture-setup-alias-validate.mjs`
