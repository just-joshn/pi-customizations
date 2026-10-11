# Verification

Every test should trace to a requirement ID or to a regression risk you have demonstrated. Wherever possible, drive the feature through the same entry point a user or the Pi runtime uses. Assert concrete values: outputs, exit codes, state, files, and errors. **A test that only shows a function was called does not count when the actual effect could be asserted instead.**

## Layers

| Layer | Proves | Typical form |
|---|---|---|
| Unit | Pure transforms, parsing, policy decisions | The repo's test runner |
| Contract | Input/output semantics, errors, configuration | Table-driven cases taken from `spec.md` |
| Pi integration | Registration, discovery, activation, lifecycle, API compatibility | Loading through Pi's real loader, or the SDK where the repo already uses it |
| CLI end-to-end | The real user invocation | `pi -p`, `pi --mode json`, `pi --mode rpc`, interactive runs via tmux where relevant |
| Regression | Each mismatch found | One test per fixed defect |
| Packaging | Install, discovery, load, removal | `pi install <path>` in an isolated `HOME`, then removal |
| Security | Untrusted inputs, side effects, failure boundaries | See [security.md](security.md) |

For control flow, use deterministic stubs in place of model calls. **Mocked internals never replace proof that Pi actually loads and runs the feature.** When a baseline exists, run the reference and the target on the same input under equivalent conditions, and compare them.

When a CLI E2E run needs credentials or a model you don't have, run everything that doesn't need them. Mark the rest INCONCLUSIVE and name the blocker.

## Independent review

Pi has no built-in subagents. Run each reviewer as a fresh process, so it shares no context with you:

```sh
pi -p --no-session "$(cat parity/<cap>/reviews/brief-parity.md)" > parity/<cap>/reviews/parity.md
```

Give all three reviewers the same `spec.md`, `ledger.json`, the diff, and the test results. Assign each one a single focus:

1. **Parity coverage:** missing behaviors, untested combinations, and tests that could pass without the behavior.
2. **Security and state integrity:** input boundaries, path and command injection, secrets, races, persistence, recovery.
3. **Architecture and maintainability:** invalid or invented API usage, leakage from the source design, needless abstraction, dead code, and limitations that aren't documented.

Tell each reviewer to cite file paths and line numbers, and to separate confirmed defects from suspicions. Check every finding against the real files and real results before you act on it.

If you cannot launch `pi -p`, for example because no model or credentials are available, do the review yourself and title it **"Self-review (not independent)"**. Never present it as an independent review.
