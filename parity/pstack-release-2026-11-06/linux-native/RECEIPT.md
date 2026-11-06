# Linux native target receipt — BLOCKED

**Clean installation, discovery, and packaged child execution: PASS. Full Linux readonly execution: BLOCKED by this container's namespace policy.** This is execution evidence for one Linux ARM64 target, not whole-plugin parity or universal OS proof.

## Exact source and target

| Item | Observed value |
|---|---|
| Source SHA | `544e2deb2cf4c404a8be1c3dc5afc2b79b21bc90` (checked before work; expected prefix matched) |
| Package source tree | `162e2bd157a28c4ffd156111d6390f3c635ca538` |
| Evidence branch | `pstack/12b98223-eb08-484c-86ac-9ab7d04cf9fc` |
| Package | `@justjoshn/pi-pstack@0.15.36-pi.20` |
| OS / libc | Debian GNU/Linux 12 (bookworm), glibc `2.36-9+deb12u14` |
| Kernel / architecture | Linux `7.2.12-orbstack-00394-gbecdd6130068`, aarch64 / Node `arm64` (native; **not x64**) |
| Initial toolchain | Node `v24.22.2`, npm `11.19.1`; Bun and Pi absent |
| Tested toolchain | CI-pinned Node `v26.13.0`, npm `11.20.0`, Bun `1.4.2`, TypeScript `7.0.2` |
| Actual Pi executable | Stable npm `@earendil-works/pi-coding-agent@1.5.0`; `pi --version` printed `1.5.0` in workspace and clean consumer |
| Linux prerequisites | bubblewrap `0.8.0`, socat `1.7.4.4`, ripgrep `13.0.0`, jq `1.6` |
| Separate statechart toolchain | Temurin `25.0.5+8-LTS` ARM64; TLC `1.7.4`, verified against CI's SHA-256 |
| Execution window | 2026-11-06, checks approximately 17:20–17:31 UTC; evidence audit followed (per-command bounds in logs) |

Only evidence files under this directory are committed. No package, test, lockfile, workflow, sandbox policy, or assertion was modified. `19-unprivileged-typecheck-and-final-identity.log` confirms unchanged source/tree and manifest hashes. Every one of the tarball's **665 files** byte-matches that exact baseline (`payload-source-match.json`).

## Declared prerequisites and installation method

Read `AGENTS.md`, root/package manifests, `.github/workflows/pi-pstack.yml`, package README, existing e2e harness/package/Task tests, and installed Pi package/RPC/JSON documentation. The requested absolute installed poteto-mode skill path was absent on this cloud machine; the task's explicit verification scope was followed instead.

Installed only declared tools and their transitive dependencies:

- Node >=22.19.0 from the manifests; used the workflow's exact Node `26.13.0` and Bun `1.4.2`. Node archive checksum checked against its official `SHASUMS256.txt`.
- Workflow's Linux `bubblewrap`, `socat`, and `ripgrep` via apt. Package README line 102 additionally declares `jq` for `worktree-audit.sh`; added it after preserving the first suite's missing-prerequisite failures.
- `bun install --frozen-lockfile` at the workspace root: 201 declared packages; no lock/manifest changes.
- Workflow's separate Java/TLC statechart prerequisites; TLC SHA-256 `936a262061c914694dfd669a543be24573c45d5aa0ff20a8b96b23d01e050e88` verified.
- Clean consumer installed only stable Pi `1.5.0`, the newly packed pstack tarball, and their declared dependency/peer closure. No workspace dev dependencies were copied. The actual tree is in `consumer-dependency-tree.json`.

Tests ran with an allowlisted environment and fresh HOME, without provider/GitHub/Slack credentials. The initial full run used this container's default root user; the final full run used existing UID 65534 (`nobody`) with a fresh owned HOME, as permission-denial tests require an unprivileged user. Only the downloaded toolchain directory's traversal permission and the ignored Vitest cache ownership were adjusted for that user. No sandbox relaxation, setuid change, sysctl change, assertion weakening, exclusion, or worker override was applied.

## Results

| Status | Check | Result / evidence |
|---|---|---|
| PASS | Baseline and native target identity | `00-baseline.log`, `19-unprivileged-typecheck-and-final-identity.log` |
| PASS | Frozen workspace dependency installation | `04-bun-install.log` |
| PASS | `bun run typecheck` | Exit 0 as both root and unprivileged user; `05-typecheck.log`, `19-…log` |
| BLOCKED | Narrow positive readonly suite | 3 passed, 2 failed; `06-readonly-tests.log`, `readonly-tests.json` |
| ISSUES | Initial full `bun run test` | 824 passed, 12 failed, 7 skipped. Three setup-dependent failures resolved below; `07-full-package-tests.log` |
| PASS | Unchanged run-lock/script tests with jq, unprivileged | 39 passed, 0 failed; `14-unprivileged-narrow-tests.log` |
| BLOCKED | Final full `bun run test` | **827 passed, 9 failed, 7 skipped / 843**; 59 passing, 5 failing, 3 skipped files; `15-unprivileged-full-tests.log`, `unprivileged-full-tests.json` |
| PASS | `bun run test:statechart` | **367 passed, 0 failed, 0 skipped** with real Java/TLC; `10-statechart-tests.log` |
| PASS | `npm pack`, fresh clean consumer npm install | 665 shipped files; no bundled node_modules or test files; `09-clean-install.log`, `pack-manifest.json`, `payload-source-match.json` |
| PASS | Actual `pi install` and `pi list` | Registered the installed tarball payload from clean consumer node_modules; no manual package registration; `09-clean-install.log`, `consumer-settings.json` |
| PASS | Pi RPC discovery and JSON round-trip | **78 skill commands**, required pstack tools and commands, command resource paths inside installed package; `consumer-discovery.json`, `consumer-checks.json`, raw RPC/JSON streams |
| PASS | Packaged Task child | `poteto-agent` child reads installed `skills/poteto-mode/SKILL.md` and `rules/no-inline-imports.mdc`, executes bash, persists transcript; `consumer-child.jsonl`, `consumer-child-record.json` |
| BLOCKED | Packaged positive readonly file/network checks | Both positive checks fail; no unsandboxed fallback and no forbidden write observed; `18-packaged-readonly-probes.log`, `consumer-readonly-checks.json` |

### Namespace blocker and skipped coverage

The direct CI probe `bwrap --ro-bind / / --unshare-net true` fails with `Creating new namespace failed: Operation not permitted`. The package's stricter actual probe fails with `No permissions to create new namespace`. All nine remaining full-suite failures depend on working readonly shell execution. They remain real failing assertions, not skips. The package refuses every attempted readonly shell command instead of running unsandboxed. That fail-closed observation does **not** establish successful readonly reads, networking, or the complete sandbox security contract.

Seven existing skips: one macOS sandbox-runtime-only test; five Docker cloud-machine tests (Docker engine/image unavailable); one ffmpeg-dependent video test. No optional tools were installed to expand this target beyond the declared verification prerequisites. Full names, failure messages, and setup/driver launch failures are preserved in `FAILURES-AND-SKIPS.md`, `failures-and-skips.json`, and the raw reports.

## Clean consumer method and artifact

`clean-install.sh` creates fresh `/tmp/pstack-linux-consumer.XXXXXX/{home,work,artifacts}`, then:

```sh
npm pack "$REPO/extensions/pi-pstack" --pack-destination "$ROOT/artifacts" --json
cd "$ROOT/work"
npm install --no-audit --no-fund @earendil-works/pi-coding-agent@1.5.0 "$TARBALL"
cp "$REPO/extensions/pi-pstack/test/fixtures/scripted-model.ts" "$ROOT/work/test/scripted-model.ts"
./node_modules/.bin/pi install "$ROOT/work/node_modules/@justjoshn/pi-pstack"
./node_modules/.bin/pi list
```

Only the unchanged scripted model fixture is copied from the source test tree. A stdlib-only wire driver adapted from `test/e2e/harness.ts` drives actual installed Pi in RPC and JSON modes, with `--offline --no-session --no-mcp --no-approve --model scripted/echo`. Settings contain exactly the installed package plus that fixture. The Task selects `poteto-agent` from packaged agent resources, reads packaged skill/rule paths, returns `PACKAGED_CHILD_EXECUTED`, and produces a real persisted child transcript. All observed parent/child assistant messages use `scripted/echo`; stored auth keys are absent/empty. Cursor executables are absent from the runtime PATH, and no Cursor resource/plugin directories exist in the clean HOME/cwd. No Cursor executable or plugin was installed or invoked.

- Tarball: `justjoshn-pi-pstack-0.15.36-pi.20.tgz`, **3,411,917 bytes** (unpacked **7,031,345 bytes**).
- SHA-256: `ce80efe79cf33fd1b4d0ee00d83f491f8b46e8d54057f0445a8c096647d25fdf`.
- Exact pack inventory/integrity: `pack-manifest.json`; checksum: `tarball-sha256.txt`.
- The temporary tarball and node_modules are not committed. They can be regenerated from the source; this branch retains logs, inventories, hashes, and the wire driver only.

## Executed commands and limitations

Every numbered `*.log` records command, cwd, UTC bounds, raw output, and real exit code through `run-command.sh`. The complete clean consumer commands are in `clean-install.sh`; exact RPC requests and raw responses are in `consumer-rpc.stdin.jsonl` / `consumer-rpc.stdout.jsonl`; JSON output and child transcript are retained separately. `12-…`, `13-…`, and `17-…` preserve resolved evidence-driver launch mistakes rather than hiding them.

This target is Debian ARM64 in a namespace-restricted container, not the workflow's Ubuntu x64 host, macOS, or Windows. A namespace-capable native Linux runner must repeat the nine readonly-dependent tests and positive file/network probes before claiming a green Linux gate. Docker cloud machines and video are not covered here. The clean consumer proves an npm tarball installed with npm and registered by actual Pi using its local-package path; the public npm registry publication/install route is not tested. npm emitted lifecycle-approval warnings for two transitive dependencies; no approval override was applied. No live model calls, provider credentials, real Slack/automation operations, public package publications, PR creation, or merges were used. Scripted inference proves resource wiring and execution, not real-model workflow adherence. No official Cursor binary was compared, and no whole-plugin parity claim follows from these results.
