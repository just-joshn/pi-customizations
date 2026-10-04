# Independent review receipt

The final production source was reviewed by `deepseek/deepseek-v4-pro`. The reviewer found no new code bugs or security flaws. Its transcript records the DeepSeek provider and model. Implementation and design workers inherited OpenAI from the active model-role configuration.

The review covered source, tests, probes, captured reference data, the parity matrix, the decision trail, and matching public Pi declarations. It audited the parent transcript without reading credential files or Keychain.

## Attention

- The captured Claude Code attribution is pinned to `2.1.288`. Its public salt and sample indices can change. The parity matrix now states the update risk and does not infer permission under Anthropic's terms. The decision trail records this choice explicitly.
- Live browser login, subscription entitlement, billing acceptance, and cache acceptance remain inconclusive. Local request equality does not establish these external outcomes. The matrix also distinguishes tested copy-code exchange from the untested complete browser-callback flow.
- `ANTHROPIC_AUTH_TOKEN` must contain a subscription-shaped token on this OAuth-only provider. API keys are rejected without exposure. This differs from configurations where Claude Code accepts an API key in that variable.
- The request-path probe intentionally pins its fixed prompt's expected fingerprint. A changed prompt must fail that assertion until a new independent vector is verified. Computing the expectation with the implementation under test would weaken the regression.
- The README's parity link was missing from the published file list. A new regression failed before the manifest included the document. The final Bun tarball includes `package/docs/claude-oauth-parity.md`. Tests and scripts remain source-checkout resources, as the README now explains.

## Verification

The merged targeted suite passes 136 tests in 16 files, including the upstream tool-transition regressions. Typecheck, coverage, shuffled tests, repository-wide tests and typechecks, Biome, agent rules, test conventions, and native-mechanism checks pass.

The four reports in `verification/` record actual Pi `1.0.0` and `1.0.1` runs. They cover print, JSON, RPC, ambient authentication without credential persistence, request identity, session correlation, fork, reload, session replacement, native tools, cancellation, usage, compaction, virtual routing, and explicit header overrides.

The packaging and disclosure follow-up did not change the original reviewed production source. The subsequent rebase preserves the upstream Pi `1.0.1` pins and request-local tool-transition compatibility fix. The four runtime reports were regenerated against this merged source, including the cached Pi `1.0.0` host. A fresh integration review covers the combined adapter.

No complete live authentication or Anthropic inference was performed.
