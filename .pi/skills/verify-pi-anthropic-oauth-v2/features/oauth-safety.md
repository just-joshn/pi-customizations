# OAuth-only request safety

The extension refuses credentials or extra configuration that could charge an API account instead of a Claude subscription. Users see actionable refusal rather than an outbound non-OAuth request.

## Sub-features

- `safety-empty`: no request without a subscription login.
- `safety-env`: Anthropic API-key/token environment variables do not supply this provider.
- `safety-config`: API keys and disallowed headers from models.json are refused.
- `safety-custom-headers`: nonempty ANTHROPIC_CUSTOM_HEADERS refuses even an otherwise valid OAuth request.
- `safety-wire-boundary`: both stream methods permit only the intended OAuth bearer and allowed beta/version header configuration.

## How to get to it (user POV)

- Configure credentials or provider overrides in Pi, select an `anthropic-oauth-v2/...` model, and send a prompt.
- Run `/claude-usage` without logging in.
- Start Pi with Anthropic environment variables set.

## Driving it with verify.py and tmux

Preconditions:

- Launch/doctor pass; baseline has no credentials or provider overrides.
- The standard helper intentionally strips Anthropic environment variables. Testing such variables requires a separately reviewed isolated launch, not injecting them into the user's session.
- Refusal with a valid OAuth credential requires authorized disposable login and an isolated configuration variant.

- **Empty-profile user path.** Run the skill's complete logged-out usage journey, including print and no-network/file assertions. This proves `safety-empty` for usage only, not every model request configuration.
- **Model refusal.** From the empty interactive profile, send `Reply with exactly OAUTH_VERIFY_OK; do not call tools.`. Capture the lack-of-credentials error and independently require no network-attempt records beyond observer startup. Do not label this as a guard-specific refusal if Pi stopped earlier.
- **Deterministic configuration matrix.** Run `bun run --filter @justjoshn/pi-anthropic-oauth-v2 test -- test/oauth-only.test.ts` and preserve the command, stdout, stderr, and exit code. The existing tests cover environment keys, stored API keys, explicit overrides, malformed OAuth credentials, model/extra headers, injected clients, SDK custom headers, and both streaming methods.
- **Live disallowed-header proof.** Complete a fresh authorized login, stop that interactive job while keeping scratch, and require an unexpired credential so refresh does not confound the network check. Write this verification-only configuration into the **scratch** profile, never the real agent directory:

  ```bash
  python3 - "$E" <<'PY'
  import json, sys
  from pathlib import Path
  e = Path(sys.argv[1])
  state = Path(json.loads((e / 'run.json').read_text())['state'])
  config = {'providers': {'anthropic-oauth-v2': {'modelOverrides': {
      'claude-sonnet-4-6': {'headers': {'X-Api-Key': 'sk-ant-api03-VERIFY-FAKE'}}}}}}
  (state / 'agent/models.json').write_text(json.dumps(config))
  (e / 'verification-models.json').write_text(json.dumps(config))
  (e / 'network-before-prompt.jsonl').write_bytes((e / 'network.jsonl').read_bytes())
  PY
  "$V" drive "$E" --feature safety-config \
    --step 'Reply with exactly OAUTH_VERIFY_OK; do not call tools.' 'anthropic-oauth-v2: refusing non-OAuth credential'
  ```

  Compare `network.jsonl` against `network-before-prompt.jsonl`: only the new process's `observer-loaded` record may be appended. Require the exact guard refusal, not an earlier missing-credentials error. Capture the action/result and config above; cleanup removes the override with scratch. This is one precise configuration variant, not proof of the whole matrix.
- **Environment variants.** `safety-env` and `safety-custom-headers` have supporting matrix tests only in this seed skill. The helper intentionally does not forward those variables. Report their real-user-path verification as NOT VERIFIED until a reviewed isolated launch is added; setting them outside the helper silently would not test them.

## Gotchas

- The matrix mocks the production HTTP boundary. It is useful supporting evidence, not a real TUI configuration or live on-wire audit.
- Fresh seed state lacks both a subscription and malicious provider overrides. `safety-config` and `safety-custom-headers` cannot be reported as user-path verified from the logged-out smoke test.
- The map deliberately does not ship fake stored OAuth credentials or a test-only auth bypass. Supply a real authorized precondition for live refusal variants, or report them NOT VERIFIED.
- Never use a real API key as a canary. Use an obviously fake value in a disposable profile, and never send it deliberately to Anthropic.
- The Node observer logs attempts, not wire headers. It cannot by itself prove the contents of a permitted live request or browser traffic.
