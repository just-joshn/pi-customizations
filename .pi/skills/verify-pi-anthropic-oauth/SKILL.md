---
name: verify-pi-anthropic-oauth
description: "Verify the pi-anthropic-oauth extension (claude-subscription provider) through the installed pi CLI: /login in the TUI (Import from Claude Code, Paste code), ambient token auth, Claude Code request identity, tool calls, and the context guard, all against a local Messages peer with synthetic tokens. Use after changing extensions/pi-anthropic-oauth, before releasing it, or when a Claude subscription user reports login, header, or tool regressions."
---

# Verify pi-anthropic-oauth

Drive `extensions/pi-anthropic-oauth` the way a user does: the installed `pi` CLI loads it with `-e`, and the harness exercises print mode, RPC mode, and the interactive TUI (inside a private tmux server). Inference goes to a local Anthropic Messages peer that records every request. No drive contacts Anthropic, reads your credentials, or opens a browser.

Read `features/README.md` before driving, then the feature file for the behavior you need to prove.

## Launch

Pi is a short-lived CLI, so there is no server to keep alive. One-time setup from the repo root:

```bash
bun install --frozen-lockfile
```

Each drive then creates its own scratch run under `$TMPDIR/verify-claude-oauth-*/` containing:

- `agent/`: `PI_CODING_AGENT_DIR`, holding `auth.json` and `models.json` (whose `claude-subscription.baseUrl` points at the local peer).
- `claude/`: `CLAUDE_CONFIG_DIR`, so Import from Claude Code reads a synthetic `.credentials.json`. A set `CLAUDE_CONFIG_DIR` also makes the Keychain lookup use a hashed service name that no real item has.
- `bin/open` and `bin/xdg-open`: stubs placed first on `PATH`. Pi's login dialog calls them to open the authorize URL; they append the URL to `open.log` instead.
- `run.json`: the tmux socket and child PIDs this run owns.

Every Pi process runs as `pi --offline --no-session -ne -ns -np -nc -e extensions/pi-anthropic-oauth ...` with `ANTHROPIC_AUTH_TOKEN`, `CLAUDE_CODE_OAUTH_TOKEN`, `ANTHROPIC_OAUTH_TOKEN`, `ANTHROPIC_API_KEY`, `CLAUDE_CONFIG_DIR`, `CLAUDE_SECURESTORAGE_CONFIG_DIR`, `CLAUDE_CODE_CUSTOM_OAUTH_URL`, and `CLAUDE_CODE_OAUTH_CLIENT_ID` removed from its environment. A drive sets only the ones its case needs.

Ready means:

- Print mode: exits. A `LOCAL_OK` stdout is a served reply.
- RPC mode: answers `get_state`. Prompts wait for `agent_settled`.
- TUI: the pane shows the `v1.` startup banner. `/login` is TUI-only in Pi 1.5.x and is not an RPC command.

Teardown happens in each drive's `finally`: the harness kills its own tmux server (`tmux -L verify-claude-oauth-<id> kill-server`), deletes that socket file, SIGKILLs only PIDs recorded in `run.json`, and removes the scratch directory.

## Doctor

Run this first, and again whenever a drive fails strangely:

```bash
./.pi/skills/verify-pi-anthropic-oauth/bin/control-claude-oauth doctor
```

The doctor checks Node `>= 22.19.0`, `pi --version` (the drives pass on 1.5.2), `tmux -V` (needed for the login drive), that the extension source and its `node_modules` exist, that it can locate the installed Pi `cli.js` (needed for the context-guard drive), and that `pi --list-models claude-subscription` lists `claude-sonnet-4-6` from a fixture credential. It also flags leftover scratch runs and prints which ambient Claude or Pi variables are set in your shell. Drives remove those variables, so they don't fail the check. The doctor exits `1` on any failure.

## Drive

```bash
B=./.pi/skills/verify-pi-anthropic-oauth/bin/control-claude-oauth
$B drive login             # TUI: /login → Claude subscription → Import from Claude Code, then Paste code
$B drive ambient-auth      # print mode: env-token precedence, API-key rejection, stored-over-ambient
$B drive request-identity  # RPC: Claude Code headers, billing fingerprint, session id, models.json override
$B drive tool-calls        # RPC: Read and Bash tool_use round-trips with Claude tool casing
$B drive context-guard     # wraps scripts/prove-context-guard.ts --expect green on the installed pi
```

Flags: `--out <dir>` writes evidence somewhere else. `--keep` keeps the scratch dir for inspection while still killing processes. Remove a kept dir with `cleanup`.

Each drive prints a JSON report with `status` (`PASS`/`FAIL`), the evidence directory, a summary, and the first failed assertion, then exits `0` or `1`. To drive the TUI by hand, use the same keystrokes the login drive sends (see `features/login.md`) against a scratch `PI_CODING_AGENT_DIR`. Never point a manual run at `~/.pi/agent`.

## Evidence

Each drive replaces `artifacts/verify-pi-anthropic-oauth/<feature>/` (gitignored) and always writes `run.json` there, containing the Pi version, status, error, and summary. Feature-specific files are listed in each feature file. A TUI failure also writes `failure-pane.txt`.

Proof standards:

- Drive the real user paths: the TUI `/login` dialog, `pi -p`, and `pi --mode rpc`. Do not call extension functions or unit-test helpers. Context-guard is the one exception: it reuses the package's own RPC proof script, which still runs the installed CLI.
- The only fakes are the Anthropic Messages endpoint (a local peer configured through `models.json`, the user-facing override), the browser opener stub, and synthetic tokens. All three sit at production boundaries.
- Assert side effects, not just output: the `auth.json` contents and its `0600` mode, the Claude credentials file left unchanged, zero requests reaching the peer when auth fails, and the headers and body of every recorded request.
- Synthetic tokens are masked in evidence (`sk-ant-oat01-…<last6>`). Never put a real token in a drive.
- "Offline" here means no inference or token exchange. The paste-code flow builds the authorize URL locally, and the stub captures it. The wrong-state code is rejected before any token request. No drive proves a real token exchange, a refresh, or subscription acceptance by Anthropic. See the Gotchas in `features/README.md`.

## Cleanup

Drives clean up after themselves even when they fail. For a kept or interrupted run:

```bash
./.pi/skills/verify-pi-anthropic-oauth/bin/control-claude-oauth cleanup
```

`cleanup` reads each `$TMPDIR/verify-claude-oauth-*/run.json`, kills that run's tmux server and recorded PIDs, deletes its tmux socket file, and removes the directory. It never kills by process name and never touches `artifacts/verify-pi-anthropic-oauth/`.

## Helpers

- `bin/control-claude-oauth`: an executable Node script with no dependencies beyond Node, `pi`, and `tmux`. Its subcommands are `doctor`, `drive <login|ambient-auth|request-identity|tool-calls|context-guard> [--out <dir>] [--keep]`, and `cleanup`. The reference request (prompt `Reply LOCAL_OK.`, user agent, and billing fingerprint) comes from `extensions/pi-anthropic-oauth/test/fixtures/claude-code-2.1.316.json`. When the pinned Claude Code version moves, update the path constant at the top of the script.
