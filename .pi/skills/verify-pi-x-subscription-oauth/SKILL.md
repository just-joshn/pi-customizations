---
name: verify-pi-x-subscription-oauth
description: "Verify the pi-x-subscription-oauth extension (grok-build and cursor providers, /usage) through the installed pi CLI: Grok Build /login in the TUI (browser callback, pasted redirect URL, device code), Cursor /login (keychain, API-key exchange, cursor-agent login), Grok Build request identity and effort aliases, live model catalogs in /model, the /usage plan meter, and Cursor asks over native HTTP/2 with the cursor-agent fallback. Every hardcoded xAI and Cursor host is answered by a local TLS peer behind a scratch CA, with synthetic tokens and stubs for the keychain, browser, and cursor-agent. Use after changing extensions/pi-x-subscription-oauth, before releasing it, or when a user reports a login, header, catalog, usage, or Cursor ask regression."
---

# Verify pi-x-subscription-oauth

This skill drives `extensions/pi-x-subscription-oauth` the way a user does. The installed `pi` CLI loads the extension with `-e`. The harness then runs print mode, RPC mode, and the interactive TUI, which runs inside a private tmux server. Nothing reaches xAI or Cursor. The extension hardcodes `auth.x.ai`, `cli-chat-proxy.grok.com`, and `api2.cursor.sh`, so the harness intercepts at the network boundary, not in extension code:

- **HTTPS fetches.** Each drive mints a scratch CA, and Pi trusts that CA only through `NODE_EXTRA_CA_CERTS`. Pi's undici `EnvHttpProxyAgent` opens a `CONNECT` tunnel through `HTTP(S)_PROXY` for every fetch. A local proxy terminates TLS for the three hosts above with a leaf certificate that the scratch CA signed, and a recording peer answers. The proxy refuses every other tunnel with 403 and logs it.
- **Cursor native ask.** It uses `http2.connect`, which ignores proxies. `bin/net-guard.mjs` is loaded with `NODE_OPTIONS=--import` and sends that call to a local HTTP/2 peer, keeping TLS servername `api2.cursor.sh` so the scratch CA still has to validate the peer.
- **Everything else.** The same guard refuses every TCP connection to a host that is not loopback, whatever the client or resolver, in each Pi process and in any Node child process it starts (they inherit `NODE_OPTIONS`). It refuses `dns.lookup` and its promise form for any name except `localhost`. It refuses every `resolve*`, `reverse`, and non-loopback `lookupService` call outright, on the module, the promises API, and both `Resolver` classes, because those query a DNS server directly over UDP. It refuses UDP (`dgram` send and connect) to any host that is not loopback. Named ESM imports of these functions get the guarded versions too. Node does not run preloads inside worker threads, so the guard refuses to create a `Worker` at all. No drive needs one, and a Pi change that starts using one fails the drive instead of running unguarded. Each refusal is logged to `egress-dns.log`.
- **Stubs first on `PATH`.** `open` and `xdg-open` log the URL instead of opening a browser. `security` is the macOS keychain CLI; it reads `keychain/<service>` files in the scratch run. `cursor-agent` logs its argv and returns a canned result. The stubs are checked-in files in `bin/stubs/`; they find the run through `VERIFY_X_RUN_ROOT`.

Read `features/README.md` before you drive, then read the feature file for the behavior you need to prove.

## Launch

Pi is a short-lived CLI, so no server stays running. Do the one-time setup from the repo root:

```bash
bun install --frozen-lockfile
```

Each drive creates its own scratch run under `$TMPDIR/verify-xsub-oauth-*/`, which contains:

- `agent/`: `PI_CODING_AGENT_DIR`, holding `auth.json` and, in some drives, `models.json`.
- `certs/`: the scratch CA and the peer leaf certificate (SANs `auth.x.ai`, `cli-chat-proxy.grok.com`, `api2.cursor.sh`), minted with `openssl`.
- `keychain/`: one file per keychain service (`cursor-access-token`, `cursor-refresh-token`, `cursor-api-key`) for the `security` stub, and `keychain-after-login`, the session the `cursor-agent login` stub saves.
- `open.log`, `security.log`, `cursor-agent.log`, `egress.log`: what the stubs and the guard saw. Each guard line is `{kind, api, target}`, for example `{"kind":"h2","api":"connect","target":"api2.cursor.sh"}`.
- `run.json`: the owning drive's PID (`ownerPid`), the tmux socket, and the child PIDs this run owns.

Every Pi process runs as `pi --no-session -ne -ns -np -nc -e extensions/pi-x-subscription-oauth ...`. It adds `--offline` everywhere except the model-catalog TUI, because catalog refresh is the network step that drive proves. The harness removes all `*_PROXY` variables (both cases), `NODE_OPTIONS`, `NODE_EXTRA_CA_CERTS`, `PI_CODING_AGENT_DIR`, `PI_OFFLINE`, `XAI_API_KEY`, `CURSOR_API_KEY`, and the `VERIFY_X_*` variables from the environment, then sets its own values.

Ready means:

- **Print mode:** the process exits. A stdout of `LOCAL_OK` is a served reply.
- **RPC mode:** the process answers `get_state`. Prompts wait for `agent_settled`.
- **TUI:** the pane shows the `v1.` startup banner. `/login` and `/model` work only in the TUI.

Each drive tears down in its `finally` block, before it writes the final `run.json`, so a failure while writing evidence cannot strand anything. Teardown kills the run's own tmux server (`tmux -L verify-xsub-oauth-<id> kill-server`) and deletes that socket file. It sends SIGKILL to a PID recorded in `run.json` only when that process's working directory is still the run's `cwd`, so a reused PID is left alone. It closes the proxy and both peers and removes the scratch directory. A failure while creating the run removes the partly built directory.

## Doctor

Run this first, and run it again whenever a drive fails in an unexpected way:

```bash
./.pi/skills/verify-pi-x-subscription-oauth/bin/control-x-subscription-oauth doctor
```

The doctor checks:

- Node `>= 22.19.0`.
- `pi --version`. The drives pass on 1.5.2.
- `tmux -V`.
- `openssl version`.
- `lsof` and `ps`. Teardown kills a recorded PID only after `lsof` confirms that the process's working directory is still the run's, and `cleanup` uses `ps` to recognize a live drive. Without them nothing is killed by mistake, but processes can leak.
- The extension source and its `node_modules`.
- An end-to-end path through the whole interception stack. With a fixture credential, `pi --offline --list-models grok-build` lists all 8 ids, and `pi -p /usage` gets its answer from the peer through the proxy and scratch CA. Nothing is refused or resolved directly, and `cursor-agent` and `security` resolve to the stubs.

The doctor also flags leftover scratch runs, ignoring any whose owning drive is still running. It fails on a `verify-xsub-oauth-*` directory that has no `run.json` from this harness, because `cleanup` will not remove it; inspect and remove that one by hand. It lists ambient variables that drives remove, such as a real `CURSOR_API_KEY`. Those variables don't fail the check. The doctor exits `1` on any failure.

## Drive

```bash
B=./.pi/skills/verify-pi-x-subscription-oauth/bin/control-x-subscription-oauth
$B drive login          # TUI: /login → Grok Build → Browser (callback, paste, wrong state) and Device code
$B drive cursor-login   # TUI: /login → Cursor → keychain import, API-key exchange, `cursor-agent login`
$B drive chat           # print + RPC: Grok Build headers, effort aliases, models.json overrides, 402, conv id
$B drive model-catalog  # offline baseline; TUI /model refreshes both catalogs; offline reuse afterwards
$B drive usage          # /usage in print mode and the TUI: logged out, meter, 401
$B drive cursor-ask     # native HTTP/2 ask, refusal text, ERROR_NOT_LOGGED_IN, cursor-agent fallback
$B drive all            # every drive above, in order
```

Flags:

- `--out <dir>` writes the evidence to another directory. With `drive all`, each feature goes to `<dir>/<feature>`.
- `--keep` keeps the scratch directory, including its logs, stubs, and `tui.sh`, but still kills its processes and closes its peers. Remove a kept directory with `cleanup`.

An evidence directory is cleared only when it is empty or holds nothing but files this harness wrote. The harness lists those files in `.verify-evidence.json`. A drive refuses an `--out` that holds anything else, and it refuses one that another live drive is still writing (`run.json` with `"status": "RUNNING"`). Two different features can run at the same time. Two drives of the same feature need different `--out` directories.

Each drive prints a JSON report and exits `0` or `1`. The report holds `status` (`PASS` or `FAIL`), the evidence directory, a summary, and the first failed assertion. A full `drive all` takes about 25 seconds on an M-series Mac. A kept run's `tui.sh` shows the exact env a drive uses, but its proxy and peers are gone once the drive exits, so it cannot be relaunched as is. To try something by hand, add a step to the drive instead. Never point a manual run at `~/.pi/agent`. Never run Cursor login or an ask without the `security` and `cursor-agent` stubs on `PATH`: on a Mac where Cursor is signed in, the real tools return real tokens and spend real usage.

## Evidence

Each drive replaces `artifacts/verify-pi-x-subscription-oauth/<feature>/`, which is gitignored. Every drive writes `steps.json` (one entry per named step: status, summary, and what it recorded) and `egress.json` (the refused tunnels, the guard log, and what the drive declared). It writes `run.json` there at the start (`RUNNING`) and rewrites it at the end, with the Pi version, platform, status, error, and summary. If `pi --version` fails, the version reads `unknown (…)`. Each feature file lists its other evidence files. A TUI failure also writes `failure-pane.txt`.

Proof standards:

- Drive the real user paths: the TUI `/login`, `/model`, and `/usage`, plus `pi -p` and `pi --mode rpc`. Do not call extension functions or unit-test helpers.
- The only fakes are these, and each sits at a production boundary:
  - the xAI and Cursor servers, reached through the proxy and scratch CA
  - the HTTP/2 redirect and DNS guard in `net-guard.mjs`
  - the `security`, `open`, and `cursor-agent` stubs
  - synthetic tokens
- Assert side effects, not just output:
  - the `auth.json` contents and its `0600` mode
  - the exact `security` and `cursor-agent` argv
  - every request the peers saw, or that they saw none
  - the PKCE verifier against the challenge
  - no network egress. After every passing drive the harness checks that no tunnel was refused and that the guard log holds exactly the `kind target` pairs the drive declares in its `egress` export (only cursor-ask declares any: `h2 api2.cursor.sh` five times). A drive cannot forget this check, and an undeclared attempt fails it.
- Every evidence file passes through a scrubber that masks anything shaped like a synthetic grok token, Cursor API key, or JWT (`verify-gro…<last6>`), in request bodies and panes as well as headers. Never put a real token in a drive.
- "Offline" here means nothing leaves the machine. No drive proves a real xAI or Cursor exchange, real refresh, real model, or real billing. See "Not drivable locally" in `features/README.md`.

## Cleanup

Drives clean up after themselves even when they fail. For a kept or interrupted run:

```bash
./.pi/skills/verify-pi-x-subscription-oauth/bin/control-x-subscription-oauth cleanup
```

`cleanup` reads each `$TMPDIR/verify-xsub-oauth-*/run.json`. It skips a directory with no readable `run.json` naming that directory, because a matching name alone does not prove this harness created it. It skips a run whose `ownerPid` is a live copy of this script, because that drive is still running. For every other run, it kills the tmux server, kills the recorded PIDs whose working directory is still the run's `cwd`, deletes the tmux socket file, and removes the directory, including the scratch CA key. It never kills by process name and never touches `artifacts/verify-pi-x-subscription-oauth/`. It uses `lsof` and `ps` to check ownership. The proxy and peers live inside the drive process, so they end with it.

## Helpers

- Layout:
  - `bin/control-x-subscription-oauth`: the command line. It wires the pieces below into the shared harness.
  - `../_shared/verify-harness.mjs`: shared with `verify-pi-antigravity-oauth`. It owns the scratch run and its ownership, `cleanup`, evidence dirs (manifest, scrubbing, `steps.json`), `runPi`, the RPC client, the tmux TUI driver, the doctor's common checks, and `drive`, which tears down before it writes the final `run.json`.
  - `lib/context.mjs`: per-run setup (scratch files, the scratch CA, the peers, the Pi env) and the egress check.
  - `lib/peers.mjs`: the proxy, the TLS peer with `route(key, handler)`, `reply()`, `sse()`, and `queue()`, and the Cursor HTTP/2 peer with named scenarios (`peers.cursor.use('refusal')`).
  - `lib/connect.mjs`: the Connect framing and the protobuf fields of Cursor's `Run`, written apart from the extension's `wire.ts`.
  - `lib/fixtures.mjs`: constants that track the extension, synthetic credentials, canned bodies, and the evidence scrubber.
  - `drives/<feature>.mjs`: one per `features/<feature>.md`. Each is a list of `ctx.step(name, fn)` calls and may export `egress`.
  - `bin/stubs/`: `open` (and `xdg-open`), `security`, and `cursor-agent`.
- `bin/control-x-subscription-oauth` is an executable Node script. It needs only Node, `pi`, `tmux`, `openssl`, and the system `lsof` and `ps`. Subcommands: `doctor`, `drive <login|cursor-login|chat|model-catalog|usage|cursor-ask|all> [--out <dir>] [--keep]`, and `cleanup`.
- `bin/net-guard.mjs` is the preload that the drives pass through `NODE_OPTIONS`. Do not run it on its own. It reads `VERIFY_X_EGRESS_LOG` and `VERIFY_X_CURSOR_H2`. It patches `net.Socket#connect`, `dns`, `http2.connect`, and `worker_threads.Worker`, and only in the processes that load it. `VERIFY_X_CURSOR_H2` holds a peer URL, or `refuse`, which sends the native ask to a closed port.
- The constants in `lib/fixtures.mjs` must track the extension:
  - `GROK_CLIENT_ID` mirrors `src/login.ts`.
  - `GROK_CLIENT_VERSION` mirrors `src/request.ts`.
  - `CURSOR_CLIENT_VERSION` mirrors `src/cursor/catalog.ts`.
  - `GROK_IDS` mirrors `BASELINE` and its effort aliases.
- `lib/fixtures.mjs` reads the authorize URL, billing, and `GetUsableModels` shapes from `extensions/pi-x-subscription-oauth/test/fixtures/`. When the extension pins a new Grok or Cursor client version, update the constants and fixtures first.
