# Real Pi runtime and packaging verification

Re-run 2026-10-12 against the identity and ambient-token revision, installed Pi **1.1.0**. Disposable HOME, agent directory, and project directory only. No global settings were edited.

## Outcome

**This run passed every harness check, including `prove:paths`.** Earlier notes in this file that say `prove:paths` failed describe a stale identity pin. The receipts beside this file are from the passing run.

| Check | Latest exit | Result |
|---|---:|---|
| Doctor before proofs | 0 | Pi 1.1.0 executable; root-package RPC command discovery works |
| `npm run prove:paths` | 0 | Normal, compaction, and virtual-route requests carried the billing block |
| Doctor after proofs | 0 | Host/RPC remains healthy; paths no longer fail |
| `npm run prove:context-guard` | 0 | GREEN: compacts before subscription run; valid payloads; every subscription request fits |
| `npm run prove:native` | 0 | Print, JSON, RPC, identity, usage, fork, reload, new session, native tools, abort pass |
| Doctor before package lifecycle | 0 | Healthy |
| Local install | 0 | Absolute source installed into disposable project settings |
| Package list after install | 0 | Source listed and resolves to requested absolute package |
| Actual `--list-models` after install | 0 | 17 `claude-subscription` models discovered, including `claude-sonnet-4-6` |
| Local removal using same absolute source | 0 | Project packages becomes `[]` |
| List / model discovery after removal | 0 / 0 | No configured package; no subscription provider models |
| `npm pack --dry-run --json --ignore-scripts` | 0 | Manifest/entrypoint included; development trees excluded |

## Commands and evidence

Read first: `.pi/skills/verify-pi-customizations/SKILL.md`, its doctor implementation, and installed `docs/packages.md` and `docs/cli.md` under `/Users/josh-desktop/.pi/agent/install/releases/1.1.0/node_modules/@earendil-works/pi-coding-agent/`.

Reproducible driver:

```sh
python3 parity/pi-anthropic-oauth/fixtures/run-runtime-verification.py \
  > parity/pi-anthropic-oauth/fixtures/harness.stdout.txt \
  2> parity/pi-anthropic-oauth/fixtures/harness.stderr.txt
```

Latest driver exit: **0**. Exact argument arrays, working directories, and individual exits are preserved in [`fixtures/commands.json`](fixtures/commands.json). Every command has separate `<name>.stdout.txt` and `<name>.stderr.txt`. The complete sanitized environment is in `fixtures/environment.json`; the scratch paths recorded there have been deleted.

The following variables abbreviate the exact paths in that ledger:

```sh
NODE=/Users/josh-desktop/.local/share/mise/installs/node/lts/bin/node
NPM=/Users/josh-desktop/.local/share/mise/installs/node/lts/bin/npm
CLI=/Users/josh-desktop/.pi/agent/install/releases/1.1.0/node_modules/@earendil-works/pi-coding-agent/dist/bundle/cli.js
PACKAGE=/Users/josh-desktop/src/personal/pi-customizations/extensions/pi-anthropic-oauth
export PI_OAUTH_CLI_PATH="$CLI"
```

Doctor was invoked from repository root before feature runs, and again after failures:

```sh
./.pi/skills/verify-pi-customizations/bin/control-pi doctor
```

A disposable PATH wrapper named `pi` executes `"$NODE" "$CLI" "$@"`, so doctor also uses the installed bundle rather than a different Pi installation.

Existing proofs were run from `$PACKAGE`:

```sh
"$NPM" run prove:paths
"$NPM" run prove:context-guard
"$NPM" run prove:native
```

All three scripts support `PI_OAUTH_CLI_PATH`. They launch actual CLI/RPC processes with synthetic credentials against a local HTTP/SSE gateway, not mocked Pi interfaces.

Package lifecycle commands were run in the disposable cwd recorded in `commands.json`, using disposable HOME and `PI_CODING_AGENT_DIR`:

```sh
"$NODE" "$CLI" install --local "$PACKAGE"
"$NODE" "$CLI" list --approve
# Only this installed-discovery command receives a synthetic OAuth token:
CLAUDE_CODE_OAUTH_TOKEN=sk-ant-oat01-runtime-verification-synthetic \
  "$NODE" "$CLI" --offline --approve --no-session --no-skills \
  --no-prompt-templates --no-context-files --no-mcp --list-models claude-subscription
"$NODE" "$CLI" remove --local --approve "$PACKAGE"
"$NODE" "$CLI" list --approve
"$NODE" "$CLI" --offline --approve --no-session --no-skills \
  --no-prompt-templates --no-context-files --no-mcp --list-models claude-subscription
```

Discovery intentionally does **not** use `-e`: it proves the installed project declaration loads the package. Pi stores the absolute install argument as a relative source in `.pi/settings.json`; the driver asserts that source resolves back to the requested package. Removal uses the same absolute source. Saved settings and assertions: `settings-installed.json`, `settings-removed.json`, `lifecycle-assertions.json`. Personal package declarations remain empty and isolated auth is absent or `{}`.

Packaging command, cwd `$PACKAGE`:

```sh
"$NPM" pack --dry-run --json --ignore-scripts
```

Metadata: `pi-anthropic-oauth@0.1.0`, 9 entries, 19,621 packed bytes / 62,053 unpacked bytes, no bundled dependencies. Includes `src/index.ts`, all source files, `package.json`, README and parity document. Excludes `node_modules`, tests, scripts, coverage. Full integrity, shasum, names and sizes are in `npm-pack-dry-run.stdout.txt`; checks in `pack-assertions.json`. No publishing or tarball creation. A separate top-level `*.tgz` check found no tarball. This is metadata verification, not installation of a generated tarball.

## Runtime findings

Context proof: two foreign seeding prompts succeed; two subscription summarizations are accepted at 117,290 and 117,204 estimated wire tokens, below the pinned 200,000-token window. Subsequent prompts include the compaction summary, remain below the window, and settle without assistant errors or payload violations.

Native proof: print and RPC return `LOCAL_OK`; JSON emits `agent_settled`; captured identity equality succeeds. Usage is input 10, output 7, cache read 4, cache write 2, total 23. Fork and new session refresh fingerprint state, reload is handled, Read returns `LOCAL_FILE`, Bash returns 40,000 native characters, and abort settles as aborted without leaving streaming enabled. Synthetic ambient token is not stored.

Paths proof on this revision: 3 agent-loop requests, 2 compaction requests, and 1 virtual-route request, each with a `2.1.296` billing block. Compaction still does not emit `before_provider_request`, and the virtual route still reports `router`, so the provider-level hook remains required. The models.json user-agent override reached every request. Earlier failed path runs are preserved under `fixtures/attempt-1/` and `fixtures/attempt-2/` and are not the current result.

## Earlier attempts

`fixtures/attempt-1/` preserves an initial harness failure: npm rejected using `/dev/null` for both user and global configuration (all npm proof commands exited 1 before running). The harness also incorrectly expected an absolute settings string. Corrected with distinct disposable npm config paths and resolved-path assertions.

`fixtures/attempt-2/` preserves actual proofs: context/native pass; paths fails the captured fingerprint assertion. Install/list/model discovery pass. Unapproved removal exits 1 with `Project is not trusted. Use --approve to modify local package config.` The final run adds documented `--approve` to removal, scoped only to the disposable project.

## Security and scope boundaries

- Environment constructed from an allowlist rather than inherited: no user API keys, OAuth tokens, auth commands, provider configuration, or npm user credentials are passed through.
- HOME, agent directory, cwd, npm cache/config paths and doctor PATH wrapper are disposable. Proof scripts additionally use their own disposable agent/cwd directories and local gateways. All scratch directories are removed on harness exit.
- Installed Pi bundle/dependencies are read/executed from the existing installation; no global install/remove/update, login, credential printing, publishing, or user auth-file access is performed.
- `PI_OFFLINE=1`, explicit offline proof/discovery flags, version-check suppression and telemetry disabling are set. Intended inference traffic is only to local fixtures; this run does not claim OS-level network sandbox enforcement.
- Synthetic credentials are nonproduction fixture values. Model listing does not perform inference, login or token refresh. Local request proofs do not establish live subscription authorization or live Anthropic compatibility.
- `--approve` trusts only the disposable cwd for each invocation. No persistent user/project trust outside scratch is changed. Doctor explicitly loads this repository's root package per the skill.
- Persistent writes by this task are confined to `parity/pi-anthropic-oauth/`. Concurrent changes outside parity belong to the identity worker and were not reverted.
