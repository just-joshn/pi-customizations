---
name: verify-pi-anthropic-oauth-v2
description: Drive pi-anthropic-oauth-v2 through the real Pi terminal UI and print CLI in an isolated profile. Use to verify Claude subscription login, model selection, /claude-usage, or OAuth-only request safety with terminal and network-attempt evidence.
---

# Verify pi-anthropic-oauth-v2

Read [features/README.md](features/README.md) first, then the feature being checked. This is a Pi extension, not a server or web app. The primary surface is Pi's TUI; print mode is a separate supported `/claude-usage` entry point. Unit tests are supporting evidence, not a substitute for driving Pi.

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

`init` records the installed Pi executable/version, extension source hashes, and a unique scratch directory in `run.json`. Scratch contains empty `home`, `agent`, and `work` directories. No migrations, credentials, or seed data are required for the logged-out journey. The helper passes an allowlisted environment: no inherited API keys, OAuth tokens, proxy settings, `NODE_OPTIONS`, or live user profile. It loads only this checkout's `src/index.ts`, disables tools, MCP, context, other extensions and skills, and uses an in-memory session with `anthropic-oauth-v2/claude-sonnet-4-6` selected explicitly.

For an automated short journey, `drive` starts its own 140x40 PTY and waits up to 30 seconds for `Press ctrl+o to show full startup help and loaded resources.` before sending anything. That prompt plus the extension command's expected result establishes usability. `print` runs once with a 45-second timeout. Both terminate their own Pi child; there is no server to keep alive.

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

Require `status: ready`, Pi `1.5.2`, the recorded executable, the scratch `agent` path, and unchanged source hashes. A changed source, missing scratch profile, or changed Pi version requires a fresh run. Doctor does not refresh credentials, start Pi, or contact Anthropic. It establishes the offline instance identity, **not** authenticated readiness. For a live run also confirm that its recorded tmux job is running; `/claude-usage` is the real user-facing check for valid subscription auth. Never use credential-printing commands as a doctor.

## Drive

### Reproducible logged-out usage proof

From the empty profile created above:

```bash
"$V" drive "$E" --feature usage-logged-out-tui \
  --step '/claude-usage' 'Claude is not logged in. Run /login and choose Anthropic (Claude subscription, OAuth).'
"$V" print "$E" --feature usage-logged-out-print --message '/claude-usage'
```

The PTY journey saves the ready terminal before the action, the exact submitted command, and subsequent terminal output. Print mode must emit the same login guidance on **stderr**, with empty stdout and exit code **0**. The command reports errors as notices; exit code alone is not success.

Check side effects and audit coverage, not just the message:

```bash
python3 - "$E" <<'PY'
import json
from pathlib import Path
import sys
p = Path(sys.argv[1])
run = json.loads((p / 'run.json').read_text())
state = Path(run['state'])
expected = 'Claude is not logged in. Run /login and choose Anthropic (Claude subscription, OAuth).'
cli = json.loads((p / 'print.json').read_text())
assert cli['exit_code'] == 0 and cli['stdout'] == ''
assert cli['stderr'].strip() == expected
assert json.loads((p / 'drive-result.json').read_text())['status'] == 'passed'
audit = [json.loads(line) for line in (p / 'network.jsonl').read_text().splitlines()]
assert len({row['pid'] for row in audit if row['kind'] == 'observer-loaded'}) == 2
assert all(row['kind'] == 'observer-loaded' for row in audit), audit
auth = state / 'agent/auth.json'
assert not auth.exists() or json.loads(auth.read_text()) == {}, 'Unexpected stored credentials'
assert not list((state / 'work').rglob('*')), 'Command wrote to the workspace'
result = {'feature': 'usage-logged-out', 'entry_points': ['TUI', 'print'],
          'network_attempts': 0, 'credentials_created': False, 'workspace_files_created': False,
          'scratch_files': sorted(str(f.relative_to(state)) for f in state.rglob('*') if f.is_file())}
(p / 'side-effects.json').write_text(json.dumps(result, indent=2) + '\n')
print(json.dumps(result))
PY
```

If this fails, report failure with the artifacts. Do not delete an unexpected credential or output file to make the assertion pass. Always clean up the failed run before retrying.

### Interactive terminal driving

For feature recipes needing menus, use **only** the tmux session returned for this run:

- `tmux send-keys -t "$TARGET" -l '/login'`, then `tmux send-keys -t "$TARGET" Enter`.
- Capture before and after each action with `tmux capture-pane -p -S - -t "$TARGET" > "$E/01-login.txt"` (choose unique numbered names).
- In a selector, type its exact provider/model name and capture the matching label before `Enter`. Use `Escape` to cancel. Do not navigate by guessed row number.
- Log submitted commands and keys to `$E/interactive-actions.txt`; the tmux screen alone does not capture every action.
- Auth secrets must be entered by the user, never through recorded `send-keys` or command arguments. Do not copy the live `~/.pi/agent/auth.json`.

`run` uses the same isolated launch as the automated PTY. Pi's offline flag suppresses automatic catalog/version requests, **not** explicit login, usage checks, or model requests. These are real network operations, not dry runs.

## Evidence

Keep `$E` under `.pi/verification-evidence/pi-anthropic-oauth-v2/`. Do not commit proof artifacts containing account or authorization data. The helper produces:

- `run.json`, `doctor.json`: build identity and isolated profile.
- `before.txt`, `actions.json`, `terminal.raw`, `terminal.txt`, `drive-result.json`: readiness, action, result, and owned-child teardown. `terminal.txt` is an ANSI-stripped **output transcript**, not a reconstructed final screen; `terminal.raw` preserves terminal controls.
- `print.json`: exact argv, stdout, stderr, exit code, and feature ID.
- `network.jsonl`: observer startup per Node process and fetch/TLS/socket attempts; no headers, bodies, URLs, or credentials.
- `side-effects.json`: independent credential/workspace checks and scratch inventory.
- `cleanup.json`: teardown result, without deleting proof.

`scripts/network-audit.cjs` is loaded by `NODE_OPTIONS=--require=...` in every driven Pi process. For a direct observer sanity check: `VERIFY_NETWORK_LOG="$E/observer-check.jsonl" node --require "$PWD/.pi/skills/verify-pi-anthropic-oauth-v2/scripts/network-audit.cjs" -e 'void 0'`. It delegates real fetch/connect calls unchanged: no fake response, blocked request, or internal setter. Its counts are Node-process attempt evidence, not a system-wide packet capture; it does not observe browser traffic or subprocesses. Explicitly scoped zero-attempt claims are valid for the logged-out command (which starts no external browser). Do not use it to claim OAuth/browser or live wire-level headers were fully audited.

Proof standards:

- Exercise the real TUI/print command; importing `createUsageCommand` is unit evidence only.
- Capture the action **and** result, and independently inspect file/network side effects.
- No mocks in user-path proof. Existing unit tests mock the external HTTP boundary; label those results as supporting tests, never live subscription proof.
- A successful login requires the real user OAuth flow and persisted credential metadata plus a subsequent real usage request. Merely seeing the provider label is not login proof.
- A successful model request requires a real assistant response under the selected provider, not only a model footer.
- Record each feature ID and entry point. A mapped path without its required account/precondition is `NOT VERIFIED`, with its reason; another entry point cannot stand in for it.
- Before sharing interactive evidence, remove OAuth URLs/codes, tokens, email addresses, and account details. Never publish raw credential files.

## Cleanup

After every successful **or failed** attempt:

1. If `run` was launched through `tmux_run`, capture remaining evidence and stop its recorded job with `tmux_jobs` `stop`. Never kill by process name or touch unrelated sessions. The `drive` helper already reaps its own PTY child, even on an expectation timeout; `print` also reaps on timeout.
2. Run `"$V" cleanup "$E"`. It removes only the unique scratch tree recorded in `run.json`, including any verification-only login. It preserves every proof file. Do not invoke it while an interactive job still uses that profile.
3. Confirm preservation: `test -s "$E/run.json" && test -s "$E/cleanup.json" && test -s "$E/actions.json" && test -s "$E/print.json" && test -s "$E/side-effects.json"` for the logged-out recipe. Confirm the recorded scratch path no longer exists.

Cleanup is repeatable. In failed runs some proof files may be absent; retain everything that exists and report the failure instead of claiming the complete recipe passed. Local deletion does not revoke an OAuth grant at Anthropic; if the user requires revocation, use the account's authorized-app controls with their approval.

## Helpers

Both files in `scripts/` are executable. `verify.py --help` lists its modes. Invocations for `init`, `doctor`, `drive`, `print`, `run`, and `cleanup` are above. `network-audit.cjs` is a preload, not a separate server; its direct invocation is shown under Evidence. Helpers require no additional Python/Node packages.

After adding or changing this skill, run `/reload` in the parent Pi session to discover it. Use `/skill:maintain-verification-skill` when commands or user journeys change.
