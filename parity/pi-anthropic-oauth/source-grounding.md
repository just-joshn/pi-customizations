# pi-anthropic-oauth: clean-room source grounding

Audit time: 2026-10-12 UTC. Repository baseline: `d9c5f51a3f0228e5ee86d3bfac68f447f109af52`. Reference executable reports **Claude Code 2.1.296**. Extension identity/reference fixture is **2.1.288**. No implementation changes were made.

## Method and provenance

Read `/Users/josh-desktop/.pi/agent/skills/port-harness-capability/references/clean-room.md` first. Evidence here is public CLI output, existing repository documents/tests, and an authorized synthetic black-box request. No Claude executable contents, disassembly, bundled/private source, real credential files, Keychain contents, login, token exchange, refresh, or remote inference were inspected or attempted.

Inspected the extension README, `docs/claude-oauth-parity.md`, `docs/review.md`, capture script, historical fixture, `test/claude-parity.test.ts`, `test/request-identity.test.ts`, `test/payload-shape.test.ts`, and relevant target identity/test helpers. Reading the target's own implementation establishes what the target does, not what Claude does. Historical documents explicitly disclose binary inspection; those claims are **not independently clean-room grounded** by this audit. No private source-derived algorithms were reproduced into these audit artifacts.

### Safe capture boundary

The existing `scripts/capture-claude.py` creates a disposable home/config directory, uses a dummy OAuth-shaped token, directs Messages to `127.0.0.1`, disables nonessential traffic/autoupdates, disables tools/customizations/MCP and session persistence, and checks for the synthetic `LOCAL_OK` response. It prints only selected identity/body fields, not authorization, account/session IDs, or the complete system prompt.

Those environment switches alone do not enforce offline operation. For this audit the entire Python process and its Claude child additionally ran under `sandbox-exec` with **network denied except localhost**, real Claude config, Pi agent directory, and user's Keychain directory denied for file reads. Invocation used `env -i`, retaining only PATH and a temporary HOME value; the script replaces HOME again. The working directory for Claude was the disposable home. CLI help says safe mode leaves authentication and managed settings active; safe mode alone is not a credential or network isolation guarantee. This receipt establishes the selected request under this constrained launch, not ordinary interactive defaults.

An initial sandbox profile using `127.0.0.1:*` failed before the capture with exit 65 (sandbox requires `localhost` or `*` as host). The corrected stored profile uses `localhost:*`. The final capture exited 0. Localhost permits other local services in principle; the audited script directs its request to its own ephemeral server. No claim is made that all managed-policy effects are absent.

## Confirmed mismatches

| Finding | Exact evidence | Qualification |
| --- | --- | --- |
| Default user agent is stale | Target regression asserts `claude-cli/2.1.288 (external, sdk-cli)`; current capture sends `claude-cli/2.1.296 (external, sdk-cli)` | Confirmed current-reference mismatch; caller overrides are supported, but do not update the billing identity. |
| Billing identity is stale for the fixed prompt | For `Reply LOCAL_OK.`, target regression asserts `cc_version=2.1.288.988`; current capture sends `cc_version=2.1.296.c4b` (both use `cc_entrypoint=sdk-cli`) | Confirmed one-prompt wire mismatch. A single vector does not establish the current fingerprint algorithm. |
| SDK preamble differs | Target request test/helper expects `You are Claude Code, Anthropic's official CLI for Claude.`; current synthetic SDK request uses `You are a Claude agent, built on Anthropic's Claude Agent SDK.` | Already deliberate/native difference. This is SDK print mode, not a claim about Claude's interactive prompt. |
| Beta-header set differs | Target's simple no-reasoning identity test asserts only `claude-code-20250219,oauth-2025-04-20`; current capture contains those plus the eight flags listed below | Confirmed for the tested target case versus the captured medium-effort reference case, **not identical reasoning settings**. Not proof that all these flags belong on Pi requests. |

Additional reference flags: `interleaved-thinking-2025-05-14`, `thinking-token-count-2026-05-13`, `context-management-2025-06-27`, `prompt-caching-scope-2026-01-05`, `effort-2025-11-24`, `dangerous-tool-use-2026-09-03`, `afk-mode-2026-01-31`, `extended-cache-ttl-2025-04-11`.

The historical/current **reference-to-reference** diff changes only the user agent and billing block in the selected projection. The historical fixture's other selected fields are unchanged: model `claude-sonnet-4-6`, `x-app: cli`, API version `2023-06-01`, the full beta list, SDK preamble, two ephemeral one-hour system cache markers, adaptive thinking with display omitted, medium output effort, and `max_tokens: 32000`. This is not full payload equality: the recorder intentionally omits most fields.

Target tests passed **46 tests in four files**. They establish the target's local behavior against loopback peers; they continue to pass despite the stale reference identity. `claude-parity.test.ts` uses literal historical expectations rather than running Claude. Its short/empty/Unicode/image/concurrency vectors are target regression vectors, not newly observed Claude vectors. A green test suite does not establish current source parity.

## Unknowns / INCONCLUSIVE

- **Current authorization URL, client ID, scopes, redirects, and OAuth exchange.** The existing matrix claims Claude uses `https://claude.com/cai/oauth/authorize` and `user:plugins`, while Pi uses `https://claude.ai/oauth/authorize`. Its stated provenance includes binary inspection; no login was launched here. Therefore this is a historical claim, not a confirmed current clean-room mismatch. A 403 on a documentation or authorization URL would not prove OAuth incompatibility.
- **Current credential precedence/accepted aliases.** Target tests establish stored-over-ambient precedence and OAuth-shaped-token rejection rules. Current help establishes the setup-token command requires a subscription and describes `--bare` as excluding OAuth/keychain. It does not independently establish current normal-mode precedence among stored credentials, `CLAUDE_CODE_OAUTH_TOKEN`, `ANTHROPIC_OAUTH_TOKEN`, and `ANTHROPIC_AUTH_TOKEN`.
- **Current billing fingerprint rule.** Only the fixed prompt's output is measured. Existing documentation attributes the salt/index rule to reverse engineering; other vectors and arbitrary first-user/meta/image/branch behavior are unconfirmed. Matching one new output would not prove the rule.
- **Context accounting and compaction thresholds.** Existing matrix describes private-source-based accounting and deliberate UTF-8/bias deviations. Target synthetic tokenizer tests and wedge-recovery probes establish target mechanisms, not current Claude token accounting, model-family constants, threshold numbers, or compaction behavior. No long-context source experiment was run. Help exposes `--autocompact <auto|tokens>` but does not disclose its algorithm.
- **Current refresh timeout, proactive margins, rotation, and error policy.** Target local tests are not current Claude observations; no real or synthetic Claude refresh was attempted.
- **Thinking/output limits.** Current selected reference emits adaptive/omitted thinking, medium effort, 32,000 output tokens. The extension deliberately delegates these policies to Pi. No matched-setting target payload comparison was added, so this report does not assign an exact current target output-cap/display mismatch.
- **Full cache/session/tool/account behavior.** Recorder selects system cache markers only, and omits auth/session headers, message caches, tool schemas, metadata and request IDs. It has no tools and one synthetic response. Exact session-header parity, tool collisions, tool transitions, metadata, cache billing/acceptance, multi-turn behavior and interactive-mode behavior are unconfirmed.
- **Service acceptance, entitlements, billing attribution, subscription permission/terms, real token validity and live login.** Loopback success proves none of these. No remote inference or live auth occurred. No requirement to impersonate unsupported beta features is inferred.
- **Latest upstream version globally.** `2.1.296` is the installed executable's version; no update command was run. “Current” in this report means that executable on this audit date, not proof it is the globally latest release.

## Public sources

Attempted GETs with Python `urllib.request.urlopen`, 20-second timeout, with no authentication:

- https://code.claude.com/docs/en/authentication
- https://code.claude.com/docs/en/cli-reference
- https://code.claude.com/docs/en/settings
- https://platform.claude.com/docs/en/build-with-claude/prompt-caching
- https://code.claude.com/docs/en/legal-and-compliance

All returned **HTTP 403**; see `fixtures/public-url-fetches.json`. They are source candidates, not fetched evidence for the claims above. No workaround or private-source fallback was used. CLI help is the successfully obtained published interface: `fixtures/claude-help.txt`, `claude-auth-help.txt`, and `claude-setup-token-help.txt`.

## Commands and receipts

Help/version commands ran via Python subprocess with an isolated home/config, clean allowlisted environment, temporary working directory, and 30-second timeout. All exited 0:

```text
claude --version
claude --help
claude auth --help
claude setup-token --help
```

No auth action was run; the last two commands only requested help.

Successful capture from repository root:

```sh
env -i PATH="$PATH" HOME=/tmp /usr/bin/sandbox-exec \
  -f parity/pi-anthropic-oauth/fixtures/loopback.sb \
  python3 extensions/pi-anthropic-oauth/scripts/capture-claude.py \
  > parity/pi-anthropic-oauth/fixtures/claude-current-capture.json \
  2> parity/pi-anthropic-oauth/fixtures/claude-current-capture.stderr
```

The capture child uses:

```text
claude --safe-mode --setting-sources '' --strict-mcp-config
  --no-session-persistence --model claude-sonnet-4-6 --effort medium
  --tools '' -p 'Reply LOCAL_OK.'
```

Target verification (exit 0):

```sh
cd extensions/pi-anthropic-oauth
bun run test -- test/claude-parity.test.ts test/request-identity.test.ts \
  test/prompt-cache.test.ts test/payload-shape.test.ts
```

Receipts in `fixtures/`: current selected capture, historical selected fixture copy, machine-readable selected-field diff, CLI help/version, empty successful capture stderr, public URL failures, loopback sandbox profile, and target test summary. Target test path was replaced by `<REPO>`; captures contain only synthetic prompt and selected public wire identity, no tokens or complete prompts. Audit requirements/evidence labels are indexed in `spec.md`.

## Bottom line

**Current identity parity fails in two directly measured fields: user agent and billing identity.** The remaining selected historical reference fields still match the current constrained reference capture. The package discloses deliberate policy differences, but its binary-inspection-derived OAuth/fingerprint/context assertions must not be promoted to clean-room verified current requirements. No implementation update is proposed or made by this evidence-only audit.
