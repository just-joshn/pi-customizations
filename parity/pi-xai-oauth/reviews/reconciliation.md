# Review reconciliation

Independent reviews: `reviews/parity.md` and `reviews/security.md`, from fresh `pi -p --no-session` processes. Architecture: `reviews/architecture.md` is a self-review because that `pi -p` produced no output.

## Fixed

- Identity test could pass by ignoring its argument and using the builtin singleton. `provider.test.ts` now passes distinct `login`, `refresh`, and `toAuth` functions and expects those same functions back.
- XAI-006 and XAI-008 cited tests that did not read the headers they named. Citations now point at `stream.test.ts` "native streaming preserves the Grok Build identity and bearer token", which checks `x-grok-client-version`, `x-xai-token-auth`, and `x-grok-model-override` on the request the local server receives.
- XAI-011's path test did not assert `stream: true` or the full `include` list. The body assertion now requires `stream: true`, `store: false`, and `include` equal to `['reasoning.encrypted_content']`.
- Catalog fetch did not set `redirect`. It now sets `redirect: 'error'`, and the catalog stub test expects that.
- A catalog `name` with a control character is dropped.

## Refuted

- Caller headers overwriting `X-XAI-Token-Auth` is intentional. `decisions.md` D3 and the README say `models.json` headers win, including the client version. It is user configuration, not catalog input.
- Alias requests do not need a separate header test for the physical id. Pi's `docs/virtual-models.md` says providers receive only the physical model returned by `route`. `grokHeaders` uses that model's `id`. The route test already expects `grok-4.7-build-fast`.

## Already recorded, not fixed

- XAI-001 browser login remains NOT VERIFIED. The authorize query is still unknown.
- XAI-013 401 refresh-and-retry remains NOT VERIFIED. Adding a retry outside Pi's credential lock could rotate a refresh token twice.
- XAI-003 scope difference remains INCONCLUSIVE. Treating 403 as "log in again" is the same gap: a shorter scope would not be fixed by repeating Pi's login.

## Left as suspicion

- `context_window` has no upper bound. A hostile catalog could publish an extreme window. No observed maximum above 500000, so a cap would be invented.
- `fetchModels` assumes `toAuth` returns `apiKey`. That matches Pi 1.1.0's xAI oauth. A future Pi change is a maintenance risk, noted in the architecture self-review.
