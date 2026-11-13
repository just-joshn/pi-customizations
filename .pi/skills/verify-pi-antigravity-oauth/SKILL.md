---
name: verify-pi-antigravity-oauth
description: "Verify the pi-antigravity-oauth extension (google-antigravity provider) through the installed pi CLI: /login in the TUI (keychain import, onboarding, browser authorize URL), chat requests in the Cloud Code envelope with per-effort model variants, tool-call round-trips, the live model catalog in /model, and the /antigravity account command, all against a local Cloud Code peer with synthetic tokens and a sink that refuses every Google call. Use after changing extensions/pi-antigravity-oauth, before releasing it, or when an Antigravity user reports login, model, request, or quota regressions."
---

# Verify pi-antigravity-oauth

Drive `extensions/pi-antigravity-oauth` the way a user does. The installed `pi` CLI loads it with `-e`, and the harness runs print mode, RPC mode, and the interactive TUI (inside a private tmux server). Every Cloud Code call (`loadCodeAssist`, `onboardUser`, `streamGenerateContent`, `fetchAvailableModels`, `retrieveUserQuotaSummary`) goes to a local peer through `CLOUD_CODE_URL`, the same override `agy` honors. All other egress goes to a local sink that refuses it and records the host. No drive reaches Google, reads your keychain, or opens a browser.

Read `features/README.md` before driving, then read the feature file for the behavior you need to prove.

## Launch

Pi is a short-lived CLI, so there is no server to keep alive. One-time setup from the repo root:

```bash
bun install --frozen-lockfile
```

Each drive creates its own scratch run under `$TMPDIR/verify-agy-oauth-*/`, which contains:

- `agent/`: the `PI_CODING_AGENT_DIR`, holding `auth.json`.
- `bin/open`, `bin/xdg-open`: stubs placed first on `PATH`. They append the authorize URL to `open.log` instead of opening a browser.
- `bin/security`: a stub for the macOS keychain CLI. It appends its argv to `security.log` and prints `keychain-password.txt` (a synthetic `go-keyring-base64:` payload). When that file is missing it exits 44, like a missing item.
- `run.json`: the tmux socket and the child PIDs this run owns.

Each drive also starts two local listeners on random ports. The Cloud Code peer records every request and answers with the drive's canned replies. The egress sink is set as `HTTP_PROXY`/`HTTPS_PROXY` with `NO_PROXY=127.0.0.1,localhost`. Pi installs undici's `EnvHttpProxyAgent`, so every other request becomes a `CONNECT` that the sink answers with 403 and logs.

Every Pi process runs as `pi --no-session -ne -ns -np -nc -e extensions/pi-antigravity-oauth ...`, with `--offline` except in the model-catalog TUI. The harness removes `CLOUD_CODE_URL`, all `*_PROXY` variables (both cases), `PI_CODING_AGENT_DIR`, and `PI_OFFLINE` from the environment, then sets its own values.

Ready means:

- Print mode: the process exits. A stdout of `LOCAL_OK` is a served reply.
- RPC mode: it answers `get_state`. Prompts wait for `agent_settled`.
- TUI: the pane shows the `v1.` startup banner. `/login`, `/model`, and the `/antigravity` notification are only available in the TUI.

Each drive tears down in its `finally`, before it writes the final `run.json`: it kills its own tmux server (`tmux -L verify-agy-oauth-<id> kill-server`), deletes that socket file, SIGKILLs a PID recorded in `run.json` only when that process's working directory is still the run's `cwd`, closes both listeners, and removes the scratch directory.

## Doctor

Run this first, and again whenever a drive fails strangely:

```bash
./.pi/skills/verify-pi-antigravity-oauth/bin/control-antigravity-oauth doctor
```

The doctor checks:

- Node `>= 22.19.0`.
- `pi --version`. The drives pass on 1.5.2.
- `tmux -V`.
- `lsof` and `ps`, which teardown and `cleanup` use to check process ownership.
- The extension source and its `node_modules`.
- That `pi --offline --list-models google-antigravity` lists `claude-sonnet-5-5` from a fixture credential.

It also reports whether keychain import is offered on this OS (darwin only), flags leftover scratch runs, and prints any proxy, `CLOUD_CODE_URL`, or Pi variables set in your shell. Drives remove those variables, so they don't fail the check. The doctor exits `1` on any failure.

## Drive

```bash
B=./.pi/skills/verify-pi-antigravity-oauth/bin/control-antigravity-oauth
$B drive login            # TUI: /login → Google Antigravity → keychain import, keychain + onboardUser, browser authorize URL + paste
$B drive chat             # print mode: envelope, agy user agent, effort → Cloud Code model id, no-credential error
$B drive tool-calls       # RPC: read (Gemini, result in model turn) and bash (Claude, result in user turn)
$B drive model-catalog    # --list-models snapshot; TUI /model shows the live catalog; offline listing then reuses the saved list
$B drive account-command  # /antigravity in print mode and TUI: not logged in, summary, quota error
$B drive all              # every drive above, in order
```

Flags: `--out <dir>` writes the evidence to another directory (`<dir>/<feature>` with `drive all`). `--keep` keeps the scratch dir for inspection but still kills the processes. Remove a kept dir with `cleanup`. An evidence dir is cleared only when it is empty or holds nothing but files this harness wrote (listed in `.verify-evidence.json`), and never while another live drive is writing it.

Each drive prints a JSON report and exits `0` or `1`. The report holds `status` (`PASS`/`FAIL`), the evidence directory, a summary, and the first failed assertion. To drive the TUI by hand, use the keystrokes from `features/login.md` with a scratch `PI_CODING_AGENT_DIR`, `CLOUD_CODE_URL` pointing at a local peer, and a stub `security` on `PATH`. Never point a manual run at `~/.pi/agent`, and never run keychain import without the stub. On a Mac that has `agy` signed in, the real `security` call returns your real token.

## Evidence

Each drive replaces `artifacts/verify-pi-antigravity-oauth/<feature>/` (gitignored). It writes `run.json` there at the start (`RUNNING`) and rewrites it at the end, with the Pi version, platform, status, error, and summary. Each feature file lists its other evidence files. A TUI failure also writes `failure-pane.txt`.

Proof standards:

- Drive the real user paths: the TUI `/login`, `/model`, and `/antigravity`, plus `pi -p` and `pi --mode rpc`. Do not call extension functions or unit-test helpers.
- The only fakes are the Cloud Code server (reached through `CLOUD_CODE_URL`, the documented override), the `security` and browser-opener stubs, the egress sink, and synthetic tokens. All of them sit at production boundaries.
- Assert side effects, not just output: the `auth.json` contents and its `0600` mode, the exact `security` argv, every request the peer saw (or that it saw none), and the egress log. The egress log shows which Google host the extension tried to reach. For example, a pasted browser code goes only to `oauth2.googleapis.com:443`, and `/antigravity` contacts only `www.googleapis.com:443` for userinfo.
- Synthetic tokens are masked in evidence (`ya29.verify-…<last6>`). Never put a real token in a drive.
- "Offline" here means nothing leaves the machine. The sink proves this by recording each refused request. No drive proves a real code exchange, a token refresh, a userinfo email, or acceptance by Google. See "Not drivable locally" in `features/README.md`.

## Cleanup

Drives clean up after themselves even when they fail. For a kept or interrupted run:

```bash
./.pi/skills/verify-pi-antigravity-oauth/bin/control-antigravity-oauth cleanup
```

`cleanup` reads each `$TMPDIR/verify-agy-oauth-*/run.json`. It skips a directory with no `run.json` naming it, and a run whose owning drive is still running. For every other run, it kills the tmux server and the recorded PIDs whose working directory is still the run's `cwd`, deletes its tmux socket file, and removes the directory. It never kills by process name and never touches `artifacts/verify-pi-antigravity-oauth/`. The peer and sink live inside the drive process, so they end with it.

## Helpers

- `bin/control-antigravity-oauth` is an executable Node script that needs only Node, `pi`, `tmux`, and the system `lsof` and `ps`. Its run lifecycle, Pi drivers, evidence, and command line come from `../_shared/verify-harness.mjs`, shared with `verify-pi-x-subscription-oauth`; the script holds the Cloud Code peer, the egress sink, the stubs, and the drives. Subcommands: `doctor`, `drive <login|chat|tool-calls|model-catalog|account-command> [--out <dir>] [--keep]`, and `cleanup`.
- The constants at the top of the script must track the extension:
  - `USER_AGENT` mirrors `userAgent()` in `src/cloudcode.ts`.
  - `SNAPSHOT_MODELS` mirrors the base ids in `src/catalog-snapshot.ts`.
- When `agy`'s version or the snapshot changes, update those constants first.
