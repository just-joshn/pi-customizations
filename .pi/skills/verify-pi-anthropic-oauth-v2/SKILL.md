---
name: verify-pi-anthropic-oauth-v2
description: Drive pi-anthropic-oauth-v2 (the custom-anthropic provider) through the real Pi terminal UI and print CLI in an isolated profile. Use to verify Claude Pro/Max login, API-key requests, model selection, or error reporting with terminal and network-attempt evidence.
---

# Verify pi-anthropic-oauth-v2

Read [features/README.md](features/README.md) first, then the feature being checked. This is a Pi extension, not a server or web app. It registers the `custom-anthropic` provider. The primary surface is Pi's TUI; print mode and `--list-models` are separate entry points. Unit tests and `scripts/verify-wire.ts` are supporting evidence, not a substitute for driving Pi.

Run commands below from the repository root. `V` and `E` are shell variables; tool calls do not preserve them, so redefine them in each call or substitute their absolute values.

## Launch

Requirements: macOS/Linux, Python 3 with POSIX PTY support, Node >=22.19, Bun, and **Pi 1.5.2** on PATH. The package is source-loaded, so there is no compilation or global package installation step. If dependencies are missing, run `bun install --frozen-lockfile` at the root. Do not update versions to make a run pass.

First verify the checkout's baseline:

```bash
bun run --filter @justjoshn/pi-anthropic-oauth-v2 test
bun run --filter @justjoshn/pi-anthropic-oauth-v2 typecheck
```

Create one fresh evidence directory per journey. Evidence lives outside scratch and survives cleanup:

```bash
V="$PWD/.pi/skills/verify-pi-anthropic-oauth-v2/scripts/verify.py"
E="$PWD/.pi/verification-evidence/pi-anthropic-oauth-v2/$(date -u +%Y%m%dT%H%M%SZ)-$$"
"$V" init "$E"
"$V" doctor "$E" > "$E/doctor.json"
printf 'Evidence: %s\n' "$E"
```

`init` records the installed Pi executable/version, hashes of every extension source file, and a unique scratch directory in `run.json`. Scratch contains empty `home`, `agent`, and `work` directories. No credentials or seed data are required for the logged-out journeys. The helper passes an allowlisted environment: no inherited API keys, OAuth tokens, proxy settings, `NODE_OPTIONS`, or live user profile. `--fake-api-key` adds `CUSTOM_ANTHROPIC_API_KEY=sk-ant-api03-VERIFY-FAKE` and nothing else. It loads only this checkout's `src/index.ts`, disables tools, MCP, context, other extensions and skills, and uses an in-memory session with `custom-anthropic/claude-sonnet-4-6` selected explicitly.

For an automated short journey, `drive` starts its own 140x40 PTY and waits up to 30 seconds for `Press ctrl+o to show full startup help and loaded resources.` before sending anything. Each `--step TEXT EXPECT` types TEXT plus Enter and waits for EXPECT in new output; an empty TEXT sends a bare Enter. `print` and `list-models` run once with a 45-second timeout. All three terminate their own Pi child; there is no server to keep alive.

For interactive authenticated journeys, generate the exact foreground command:

```bash
printf '"%s" run "%s"\n' "$V" "$E"
```

Pass that output as **`tmux_run`**'s `command`, with `name` set to `verify-anthropic-interactive`. The returned job identifies the exact tmux session. Wait for the Pi editor and model footer before driving. Record the job ID and session target in the evidence directory. Stop that job with `tmux_jobs` `stop` **before** deleting scratch. Never launch a second driver against the same evidence/profile.

Independent runs can coexist: every `init` gets a distinct profile, HOME, cwd, and no persistent session or listening port. OAuth completion still shares the human's browser/account and subscription quota; serialize authenticated runs. Never drive the user's existing Pi session.

## Doctor

Run this read-only identity check first whenever anything looks off:

```bash
"$V" doctor "$E"
```

Require `status: ready`, Pi `1.5.2`, the recorded executable, the scratch `agent` path, and a `source_files` count. Doctor fails if any extension source changed since `init`. A changed source, missing scratch profile, or changed Pi version requires a fresh run. Doctor does not start Pi or contact Anthropic. It establishes the offline instance identity, **not** authenticated readiness. For a live run also confirm that its recorded tmux job is running; a real prompt response is the user-facing check for valid credentials. Never use credential-printing commands as a doctor.

## Drive

### Smoke journey

Run each in its own fresh `init`/`doctor` evidence directory (`E1`, `E2`, `E3`):

```bash
"$V" drive "$E1" --feature login-picker \
  --step '/login' 'Sign in with an account' \
  --step '' 'Custom Anthropic (Claude Pro/Max)'
"$V" print "$E2" --feature request-no-credentials
"$V" print "$E3" --feature request-error --fake-api-key
```

The PTY journey saves the ready terminal before the action, the exact submitted steps, and subsequent terminal output. The first print must exit 1 with `No API key found for custom-anthropic.` on stderr. The second must exit 1 with a stderr line matching `AuthenticationError 401 (request req_…): invalid x-api-key`, which comes from a real request to Anthropic with a fake key.

Check side effects and audit coverage, not just the message:

```bash
python3 - "$E1" "$E2" "$E3" <<'PY'
import json, re, sys
from pathlib import Path
picker, missing, fake = (Path(p) for p in sys.argv[1:])
def audit(p):
    return [json.loads(line) for line in (p / 'network.jsonl').read_text().splitlines()]
def state(p):
    return Path(json.loads((p / 'run.json').read_text())['state'])
assert json.loads((picker / 'drive-result.json').read_text())['status'] == 'passed'
cli = json.loads((missing / 'print.json').read_text())
assert cli['exit_code'] == 1 and 'No API key found for custom-anthropic.' in cli['stderr']
err = json.loads((fake / 'print.json').read_text())
assert err['exit_code'] == 1
assert re.search(r'^AuthenticationError 401 \(request req_\w+\): invalid x-api-key$', err['stderr'], re.M)
for p in (picker, missing):
    rows = audit(p)
    assert rows and all(row['kind'] == 'observer-loaded' for row in rows), rows
assert any(row['kind'] != 'observer-loaded' for row in audit(fake))
for p in (picker, missing, fake):
    auth = state(p) / 'agent/auth.json'
    assert not auth.exists() or json.loads(auth.read_text()) == {}, 'Unexpected stored credentials'
    assert not list((state(p) / 'work').rglob('*')), 'Pi wrote to the workspace'
result = {'features': ['login-picker', 'request-no-credentials', 'request-error'],
          'zero_network': ['login-picker', 'request-no-credentials'],
          'credentials_created': False, 'workspace_files_created': False}
(fake / 'side-effects.json').write_text(json.dumps(result, indent=2) + '\n')
print(json.dumps(result))
PY
```

Run this before `cleanup`, because it reads scratch. If it fails, report failure with the artifacts. Do not delete an unexpected credential or output file to make the assertion pass. Always clean up the failed run before retrying.

### Interactive terminal driving

For feature recipes needing a human, use **only** the tmux session returned for this run:

- `tmux send-keys -t "$TARGET" -l '/login custom-anthropic'`, then `tmux send-keys -t "$TARGET" Enter`.
- Capture before and after each action with `tmux capture-pane -p -S - -t "$TARGET" > "$E/01-login.txt"` (choose unique numbered names).
- In a selector, type its exact provider/model name and capture the matching label before `Enter`. Use `Escape` to cancel. Do not navigate by guessed row number.
- Log submitted commands and keys to `$E/interactive-actions.txt`; the tmux screen alone does not capture every action.
- Auth secrets must be entered by the user, never through recorded `send-keys` or command arguments. Do not copy the live `~/.pi/agent/auth.json`.

`run` uses the same isolated launch as the automated PTY. Pi's offline flag suppresses automatic catalog/version requests, **not** explicit login token exchange or model requests. These are real network operations, not dry runs.

## Evidence

Keep `$E` under `.pi/verification-evidence/pi-anthropic-oauth-v2/`. Do not commit proof artifacts containing account or authorization data. The helper produces:

- `run.json`, `doctor.json`: build identity and isolated profile.
- `before.txt`, `actions.json`, `terminal.raw`, `terminal.txt`, `drive-result.json`: readiness, action, result, and owned-child teardown. `terminal.txt` is an ANSI-stripped **output transcript**, not a reconstructed final screen; `terminal.raw` preserves terminal controls.
- `print.json`, `list-models.json`: exact argv, whether the fake key was set, stdout, stderr, exit code, and feature ID.
- `network.jsonl`: observer startup per Node process and fetch/TLS/socket attempts; no headers, bodies, URLs, or credentials.
- `side-effects.json`: independent credential/workspace checks for the smoke journey.
- `cleanup.json`: teardown result, without deleting proof.

`scripts/network-audit.cjs` is loaded by `NODE_OPTIONS=--require=...` in every driven Pi process. For a direct observer sanity check: `VERIFY_NETWORK_LOG="$E/observer-check.jsonl" node --require "$PWD/.pi/skills/verify-pi-anthropic-oauth-v2/scripts/network-audit.cjs" -e 'void 0'`. It delegates real fetch/connect calls unchanged: no fake response, blocked request, or internal setter. Its counts are Node-process attempt evidence, not a system-wide packet capture; it does not observe browser traffic or subprocesses. Zero-attempt claims are valid for the login menus and the missing-credentials prompt, which start no browser. Do not use it to claim OAuth/browser traffic or wire-level headers were audited.

Proof standards:

- Exercise the real TUI/print command; importing the extension is unit evidence only.
- Capture the action **and** result, and independently inspect file/network side effects.
- No mocks in user-path proof. Unit tests and `verify-wire.ts` use a mocked or local HTTP boundary; label those results as supporting, never live subscription proof.
- A successful login requires the real user OAuth flow, persisted credential metadata, and a subsequent real response. Seeing the provider label is not login proof.
- A successful model request requires a real assistant response under `custom-anthropic`, not only a model footer. The fake-key 401 proves the error path only.
- Record each feature ID and entry point. A mapped path without its required account/precondition is `NOT VERIFIED`, with its reason; another entry point cannot stand in for it.
- Before sharing interactive evidence, remove OAuth URLs/codes, tokens, email addresses, and account details. Never publish raw credential files.

## Cleanup

After every successful **or failed** attempt:

1. If `run` was launched through `tmux_run`, capture remaining evidence and stop its recorded job with `tmux_jobs` `stop`. Never kill by process name or touch unrelated sessions. `drive`, `print`, and `list-models` reap their own Pi child, even on timeout.
2. Run `"$V" cleanup "$E"` for every evidence directory. It removes only the unique scratch tree recorded in `run.json`, including any verification-only login. It preserves every proof file. Do not invoke it while an interactive job still uses that profile.
3. Confirm preservation: `test -s "$E/run.json" && test -s "$E/cleanup.json"` plus the journey's own artifact (`drive-result.json`, `print.json`, or `list-models.json`). Confirm the recorded scratch path no longer exists.

Cleanup is repeatable. In failed runs some proof files may be absent; retain everything that exists and report the failure instead of claiming the recipe passed. Local deletion does not revoke an OAuth grant at Anthropic; if the user requires revocation, use the account's authorized-app controls with their approval.

## Helpers

Both files in `scripts/` are executable. `verify.py --help` lists its modes: `init`, `doctor`, `drive`, `print`, `list-models`, `run`, and `cleanup`, with invocations above and in the feature files. `network-audit.cjs` is a preload, not a separate server; its direct invocation is shown under Evidence. Helpers require no additional Python/Node packages.

After adding or changing this skill, run `/reload` in the parent Pi session to discover it. Use `/skill:maintain-verification-skill` when commands or user journeys change.
