# pi-anthropic-oauth

Use a Claude subscription in Pi through its native provider, login, credential storage, and Anthropic streaming mechanisms.

The package registers `claude-subscription`. Existing credentials and saved model selections keep that provider ID. It does not read Claude Code's credential files or macOS Keychain.

## Sign in through Pi

From this directory, start Pi:

```bash
pi -e .
```

Run `/login` and choose **Claude subscription (Provider CLI)**. Use Pi's browser or copy-code login. Select a `claude-subscription` model with `/model`.

To install the package, run `pi install` with this directory's path.

## Use a setup token

Generate a subscription token with `claude setup-token`. Supply it through `CLAUDE_CODE_OAUTH_TOKEN` using your shell's secret-input mechanism. Do not put the token in scripts, project settings, or shell history.

Start Pi with the provider selected:

```bash
pi -e . --provider claude-subscription --model claude-sonnet-4-6
```

The provider also accepts subscription access tokens from `ANTHROPIC_OAUTH_TOKEN` and `ANTHROPIC_AUTH_TOKEN`, in that order after `CLAUDE_CODE_OAUTH_TOKEN`. API keys are rejected on these paths. Ambient tokens are not copied into Pi's credential store and cannot refresh themselves.

Pi's stored credential takes precedence over ambient tokens. Use Pi's `/logout` if you want to stop using the stored credential. A failed refresh retains that credential rather than silently switching accounts.

## Override request headers

Use Pi's `models.json` for explicit header overrides. For example:

```json
{
  "providers": {
    "claude-subscription": {
      "headers": { "user-agent": "claude-cli/2.1.288 (external, sdk-cli)" }
    }
  }
}
```

The default identity matches the locally captured Claude Code `2.1.288` SDK request. The billing fingerprint derives from the request's first user text. Header overrides do not change the captured version used in that fingerprint.

Pi still controls thinking, output limits, tool execution, retries, compaction, model selection, and usage accounting. The package does not replace Pi's prompt or Bash-output policy.

Read the [parity matrix](docs/claude-oauth-parity.md) for verified behavior, deliberate differences, native API gaps, and live-authentication limitations. This package does not claim complete Claude Code feature parity.

## Verify the integration

These checks require a source checkout. The installed package includes the parity matrix, but not tests or verification scripts.

From the repository root, install the declared dependencies:

```bash
bun install --frozen-lockfile
```

From this directory, run the checks:

```bash
bun run test
bun run typecheck
bun run test:coverage
bunx vitest run --sequence.shuffle
node --experimental-strip-types scripts/prove-request-paths.ts
node --experimental-strip-types scripts/prove-native.ts
```

The tests use native Pi providers, authentication, and streams against local HTTP peers. `prove-request-paths.ts` verifies normal prompts, compaction, virtual routing, and `models.json` header overrides. `prove-native.ts` verifies print, JSON, RPC, ambient authentication, session correlation, fork, reload, session replacement, tool execution, native Bash output, and cancellation.

These probes use disposable Pi directories and synthetic tokens. They do not contact Anthropic for inference or inspect your credentials. Set `PI_OAUTH_CLI_PATH` to an installed Pi's `dist/bundle/cli.js` to repeat them against that host. They otherwise use the package's pinned Pi `1.0.0` test dependency. Both probes have also passed against the locally installed Pi `1.0.1`.

Capture the installed Claude Code reference with Python 3:

```bash
python3 scripts/capture-claude.py
```

The capture runs Claude Code with an isolated home, safe mode, no tools, no session persistence, a synthetic OAuth token, and a local Messages endpoint. It prints only the selected request fields in `test/fixtures/claude-code-2.1.288.json`. No auth headers, account identifiers, complete prompts, or credential contents appear in the output. `CLAUDE_BIN` can select a different Claude executable.

When refreshing the identity, recapture the reference and update `src/identity.ts` and its literal regression vectors together. Do not import Claude Code internals or execute Claude Code from the extension factory.

From the repository root, run the packaging and style checks:

```bash
bunx biome ci extensions/pi-anthropic-oauth --error-on-warnings --max-diagnostics=none
bun run check:agents
bun run check:tests
node scripts/check-pi-mechanisms.mjs
```
