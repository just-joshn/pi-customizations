The ledger verdict **NOT VERIFIED** is the right overall verdict. It should not be upgraded. Several **VERIFIED** rows are too strong if they are read as source parity. Passing target tests are not source observations.

## Confirmed: VERIFIED rows that are too strong

**OAUTH-001** (`ledger.json` lines 6–13) claims Claude subscription requests use bearer auth and omit `x-api-key`. The cited `fixtures/claude-current-capture.json` is not at that path. The real capture, `fixtures/attempt-1/claude-current-capture.json`, records only `user-agent`, `x-app`, `anthropic-version`, and `anthropic-beta` (`scripts/capture-claude.py` line 9). It cannot prove bearer auth or the absence of `x-api-key`.

The named test only checks that the header is missing:

```56:58:extensions/pi-anthropic-oauth/test/request-identity.test.ts
test('no x-api-key header is sent', async ({ models, model, server }) => {
  await collect(models.streamSimple(model, prompt));
  expect(soleRequest(server).headers).not.toHaveProperty('x-api-key');
});
```

That passes with no `Authorization` header at all. The source fixture that does record scheme, `fixtures/credential-precedence.json` lines 8–14, is not cited. Its last print-mode row selects `ANTHROPIC_AUTH_TOKEN` as Bearer and still sets `x_api_key: true`. "Without `x-api-key`" is not what Claude did in that measured case.

**OAUTH-004** (lines 32–38) is too strong for "uncached attribution" and for cache behavior beyond one selected system list. The capture stores a bare list of two `ttl: "1h"` controls. It does not say which block they belong to, and it drops tool and message cache markers. `prompt-cache.test.ts` checks the target, including lifting `short` to one hour. That policy is not a source observation.

**OAUTH-009** (lines 76–83) says both a setup token and `ANTHROPIC_AUTH_TOKEN` are accepted. The named test only sets `CLAUDE_CODE_OAUTH_TOKEN` and checks that the store stays empty (`claude-parity.test.ts` lines 58–66). It passes if `ANTHROPIC_AUTH_TOKEN` is rejected. Acceptance of that variable is a different test, `auth-boundaries.test.ts` lines 8–11, and is not the acceptance pointer. `claude setup-token --help` does not name either variable.

**OAUTH-011** (lines 92–99) has no source observation. The evidence is synthetic token errors and abort tests. `spec.md` still lists the token path as unknown. **VERIFIED** here is a local wrapper contract, not Claude error or cancel parity. Login response-body stripping is also not the cited refresh test (`claude-parity.test.ts` lines 98–106). The `catch` in `src/auth.ts` lines 18–33 replaces every non-abort error, but no login test feeds a token-bearing HTTP body.

**OAUTH-013** (lines 110–116) is target loopback only. The capture script fabricates the SSE reply, so it does not observe Claude's stream. The named file, `responses.test.ts`, covers text, tools, images, usage, and Unicode. It has no abort or cancel test. Those live in `stream-failures.test.ts` and `prove-native.ts`. The cited acceptance test passes without cancellation semantics.

**OAUTH-015** (lines 126–132) overclaims reload. `prove-native.ts` lines 60–67 check the user agent, billing, and no `x-api-key` only on the first three requests. After `/verify_oauth_reload`, lines 74–75 only require the command result `"handled"` and a later `LOCAL_OK`. The command is `ctx.reload()` (`scripts/request-event-probe.ts` lines 26–31). The gateway still emits `LOCAL_OK`, so this passes without proving a post-reload billing block, bearer auth, or a fresh fingerprint. Fork and new-session fingerprint checks are narrower and do exist.

## VERIFIED rows that are not too strong for the named local claim

**OAUTH-002** matches the stored capture for the two fields it names. `fixtures/attempt-1/claude-current-capture.json` and `test/fixtures/claude-code-2.1.296.json` agree on `claude-cli/2.1.296 (external, sdk-cli)` and `cc_version=2.1.296.c4b` for `Reply LOCAL_OK.`. The acceptance test reads the fixture, not the capture (`claude-parity.test.ts` lines 46–52), so it would stay green if those files diverged. That is a binding gap, not a false match today. It does not cover `x-app` or the beta list. The beta mismatch is correctly left in **OAUTH-018**.

**OAUTH-026** matches the measured print-mode and auth-status ranking of `ANTHROPIC_AUTH_TOKEN` over `CLAUDE_CODE_OAUTH_TOKEN` (`credential-precedence.json` lines 9 and 16–18; `src/auth.ts` lines 3–16; `auth-boundaries.test.ts` lines 20–28). The test does not load the fixture and does not send the winning token on the wire. The ranking claim itself holds.

**OAUTH-014** and **OAUTH-022** are Pi integration receipts, not Claude observations. `prove-paths.stdout.txt` shows billing blocks on compaction and virtual-route requests. `lifecycle-assertions.json` records install, list, and remove. Do not read either as source parity. The `2.1.296.eb7` pin in `prove-request-paths.ts` line 78 is only the target hash of `"first"`. No fixture contains that prompt or `eb7`. `docs/claude-oauth-parity.md` line 45 calls it independently observed. That sentence is unsupported. The path proof also forces `user-agent: claude-cli/9.9.9`, so it does not prove default identity, bearer auth, or cache markers on those paths.

## Missing NOT VERIFIED or INCONCLUSIVE coverage

These are measured or explicitly unmeasured and are not their own rows:

1. **NOT VERIFIED, missing.** When `ANTHROPIC_API_KEY` and `ANTHROPIC_AUTH_TOKEN` are both set, Claude selects the auth token as Bearer and still sends `x-api-key` (`credential-precedence.json` line 14). **OAUTH-010**'s gap says Claude prefers the API key over a setup token. That is a different row (line 13). The dual-header case is not what this provider does (`src/auth.ts` lines 7–8 rejects non-`sk-ant-oat01-` values), and no test sends both variables and inspects both headers.

2. **INCONCLUSIVE, missing.** Interactive TUI login precedence is in `credential-precedence.json` line 23 `not_measured` and is not an id. **OAUTH-003** covers interactive fingerprint, not credential choice. **OAUTH-006** covers browser callback completion, not TUI precedence.

3. **INCONCLUSIVE, missing from the ledger, overclaimed in the doc.** `x-claude-code-session-id` is not in the Claude capture. `docs/claude-oauth-parity.md` line 16 marks session correlation **VERIFIED** from Pi's `sessionId` (`prove-native.ts` line 60). That is a local mapping, not source equivalence.

4. **INCONCLUSIVE, swallowed by OAUTH-004.** Tool and message cache TTLs, and which system block is uncached, were not recorded. They need their own inconclusive row, or **OAUTH-004** must be narrowed.

Stored-versus-environment order is not a missing id. It is already the **OAUTH-010** gap and the fixture's `not_measured` list. **OAUTH-005**, **006**, **007**, **008**, **012**, **016**, **017**, **018**, **019**, **020**, **021**, **023**, and **025** are present and should stay unresolved. **OAUTH-024** as not applicable matches the spec's exclusion.

## Doc versus ledger

`docs/claude-oauth-parity.md` lines 18–34 marks copy-code OAuth, refresh rotation, and context accounting **VERIFIED** or **VERIFIED locally**. The ledger has those as **INCONCLUSIVE** (**OAUTH-005**, **OAUTH-008**) and **NOT VERIFIED** (**OAUTH-016**). The context cell even says the checks do not establish Claude accounting. A green `context-tokens` or `prompt-cache` run must not be promoted to source parity.

`spec.md` line 20 still says current source precedence for 009–011 is unknown. Ambient print-mode order was later measured. That table line is stale. The material-unknowns paragraph is the accurate one.
