# Pi 1.5.0 upgrade verification

## Scope

Upgrade the five extensions other than `pi-rea` against Pi 1.5.0. Preserve their existing upstream targets and use the host's public mechanisms. The baseline commit is `400a83f9d0cf9ea550905d01e7d28fe2ca657ac1`.

This report does not certify complete upstream parity. Maintainer has 11 existing open native-gap contracts. Live OAuth login, subscription entitlement, and successful remote inference were not exercised.

## Changes

- All five packages pin their Pi development dependencies to 1.5.0. Host packages remain peers. The `pi-rea` manifest and lockfile importer retain their baseline values.
- Pstack authors its string enums with TypeBox so optional fields and literal types survive Pi 1.5's schema separation. Native argument-validation tests cover valid, coercible, and invalid values.
- Pstack preserves `Usage.cost.totalFromProvider` when combining subagent usage, following Pi's all-contributions rule.
- Antigravity regenerates its eight native helper copies against Pi 1.5.0 with the existing documented transformations. Its tests import TypeBox directly. Regressions cover updated constrained sampling and Gemini constant conversion.
- Current native-gap documentation distinguishes Pi 1.5 contract inspection from historical runtime receipts. All five package changelogs now have versioned release entries dated 2026-11-02. The release preparation bumps Anthropic to 0.1.8, Antigravity to 0.1.4, maintainer to 0.1.2, pstack to 0.15.36-pi.7, and xAI to 0.1.4. Pi discovers the package-root changelogs without a custom path. No publication or installed-user update notice is claimed.

## Verified checks

The following commands passed in the main checkout with Node 26.13.0, Bun 1.4.2, and Pi CLI 1.5.0.

| Check | Result | Local evidence |
| --- | --- | --- |
| `make verify-extension` | Pstack typecheck, 556 tests, and coverage thresholds pass | `/tmp/pi-150-upgrade/pstack-maintainer-final.log` |
| Pstack `test -- --typecheck test/task-schema.test-d.ts test/native-tool-validation.test.ts` | 13 runtime and type tests pass with no type errors | `/tmp/pi-150-upgrade/schema-types-final.log` |
| `make verify-maintainer` | Maintainer typecheck, 1,943 tests, and coverage thresholds pass | `/tmp/pi-150-upgrade/pstack-maintainer-final.log` |
| `make verify-oauth` | Anthropic 393 tests, Antigravity 349 tests, xAI 125 tests, typechecks, and coverage thresholds pass | `/tmp/pi-150-upgrade/oauth-final.log` |
| Anthropic synthetic proofs within `verify-oauth` | Print, JSON, RPC, context guard, native tools, cancellation, reload, and session paths pass | `/tmp/pi-150-upgrade/oauth-final.log` |
| Antigravity vendor and native-gap checks | Match Pi 1.5.0 with documented adaptations | `/tmp/pi-150-upgrade/oauth-final.log` |
| xAI model-listing proof | Eight Grok Build models registered | `/tmp/pi-150-upgrade/oauth-final.log` |
| `node scripts/check-pi-mechanisms.mjs` | Public host module and package checks pass | `/tmp/pi-150-upgrade/mechanisms.log` |
| `bun run check:toolchain` | Toolchain and workspace dependencies pass | `/tmp/pi-150-upgrade/toolchain.log` |
| `node scripts/verify-fresh-install.mjs` | All three OAuth packages load without package-local dependencies | `/tmp/pi-150-upgrade/fresh-install-final.log` |
| Project `control-pi` doctor and pstack command and mode drives | Real Pi 1.5 RPC command discovery and mode on/off pass after integration | `/tmp/pi-150-upgrade/after/` |
| Project `control-pi` OAuth drive | Fixture-backed provider discovery and logged-out Antigravity report pass | `/tmp/pi-150-upgrade/oauth-providers/` |
| `bun run --filter @justjoshn/pi-pstack test:statechart` | 267 pass, 67 skip, zero fail | `/tmp/pi-150-upgrade/statechart.log` |

Logs under `/tmp` are local run artifacts, not portable repository evidence. The commands above rerun the checks. Statechart skips require TLC tooling and are not verified outcomes.

## Independent review

A correctness review of the dependency, helper, provenance, and documentation changes found no actionable defects in `400a83f9..94592595`. A separate schema review of `8541fe5e` confirmed that all four serialized enum shapes match the previous string schemas under both local and installed-host dependencies. It independently passed the 556-test pstack suite and explicit type tests. These scoped reviews do not certify complete upstream parity.

A Claude Haiku 4.5 evidence audit checked the logs and decision trail at `8541fe5e`. It confirmed the reported outcomes and flagged the disclosed live-service and missing-parity-source limitations. Its additional finding, a missing Antigravity unreleased changelog entry, was corrected after review.

## Failed or blocked checks

- `make verify` stops at the lint gate. The baseline and final runs both report 154 errors and 398 warnings. No bulk lint cleanup was included. See `/tmp/pi-150-upgrade/baseline-verify.log` and `/tmp/pi-150-upgrade/final-make-verify.log`.
- `bun run check:tests` reports six pre-existing unmanaged `globalThis.fetch` assignments in Anthropic tests. See `/tmp/pi-150-upgrade/final-conventions.log`.
- Maintainer `check:parity` cannot read its pinned reconstruction document at `/Users/josh-desktop/Documents/FREE/Aider-Precise-Code-Editing-Software-Architecture-Reconstruction.md`. The gate was not weakened. See `/tmp/pi-150-upgrade/maintainer-parity.log`.
- Maintainer's existing ledger has 11 open native-gap contracts. The final parity predicate is not satisfied.
- `git diff --check` reports space-before-tab context lines inside the Antigravity unified patch. Those spaces are unified-diff context markers followed by upstream tab indentation.
- No live model-dependent pstack journey or real OAuth exchange was run. Fixture-backed discovery and synthetic inference do not prove service acceptance.

## Native mechanisms retained

Pi 1.5 still lacks the complete RPC process controls, attached-skill formatter, target-ID fork API, and pure exported workspace-folder helper required by pstack. Maintainer's environment-isolating command adapter remains necessary because `ExecOptions` adds `maxBuffer` but still has no `env`. Antigravity's Cloud Code transport still requires its documented adapter. The package native-gap documents record these boundaries.
