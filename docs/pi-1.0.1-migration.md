# Pi 1.0.1 migration

## Scope

The migration covers all six packages under `extensions/`. Pi development dependencies pin `1.0.1`. Executable packages retain wildcard host peers. The theme-only package has no runtime imports or host peers.

The audit uses the installed Pi 1.0.1 changelog, official documentation, exported declarations, and checked examples. Historical parity reports and reference snapshots retain their original version labels.

## Package audit

| Package | Migration | Verification |
| --- | --- | --- |
| `pi-anthropic-oauth` | Retain native OAuth and Anthropic streaming. Select Pi's current-tool request path for case-colliding tool histories. Preserve inline transitions elsewhere. | Provider coverage, both stream methods, request captures, reply dispatch, concurrency, and the real RPC request-path probe. |
| `pi-antigravity-oauth` | Regenerate the vendored helper subset from Pi AI 1.0.1. The helper changes are provenance headers. Retain the required Cloud Code Assist protocol adapter. | Types, provider coverage, OAuth fixtures, and `check:vendor`. |
| `pi-xai-oauth` | Update the host target. Retain the subscription authentication and protocol adapter. No native replacement was found in this release. | Types, provider coverage, and provider discovery through real Pi. |
| `pi-one-dark-pro-theme` | Update the host target. No theme format migration is required. | Theme coverage and the real terminal smoke test. |
| `pi-pstack` | Derive the progress verifier's target from the manifest. Install native MCP, codemode, and tool-search factories in writable local uppercase `Task` SDK sessions. The lowercase `task` runtime already installs them. | Types, coverage, version regression, native MCP project overrides in both runtimes, readonly restrictions, and the real progress TUI. |
| `pi-tui-skin` | Replace builtin execution wrappers with a readonly `ToolRenderers` table and `registerToolRenderer()`. Pi owns execution and tool activation. Delete obsolete activation settings and wrapper tests. | Types, coverage, native loader and SDK tests, boundary lint, prompt parity, and the complete terminal smoke suite. |

## Release applicability

| Pi 1.0.1 change | Repository verdict |
| --- | --- |
| Tool renderers for tools that are not registered | The skin now uses the native resolver. Unknown names delegate to `next()`. Tests cover all eight builtin renderers and downstream identity. |
| Inline Anthropic tool additions and redefinitions | The subscription adapter needs a collision-specific native capability choice. Regression captures reproduce overwritten winners, withdrawn surviving tools, and missing promotion before the fix. |
| Project overrides for user MCP servers | Pi's native loader owns the merge. Both local delegation runtimes test enabled and disabled project overrides. No custom merge or server transport was added. |
| MCP Client ID Metadata Documents | Native MCP factories own authentication. No repository OAuth or registration implementation duplicates this feature. |
| Codemode output limits | Native codemode owns execution and limits. Writable SDK workers now load its public factory. No parallel script runner was added. |
| Cloudflare Clef classifiers and provider catalog fixes | Pi owns these catalogs and classifier APIs. No affected custom classifier registry was found. Subscription provider suites still pass. |
| Provider-capacity retries and model-cycle parsing | Pi owns retry and CLI model selection. Pstack does not add a replacement loop or parser. |
| Image rendering, resumed MCP rows, and HTML export fixes | Native Pi TUI and export code own these behaviors. The renderer migration removes the skin's execution coupling. No image codec or export patch was added. |
| OAuth sign-in copy key and occupied ChatGPT callback port | Native login UI and callback handling own these behaviors. Existing subscription adapters have no release-specific replacement. |
| Nix, managed installation guidance, and removal of npm shrinkwrap | No Nix or global-npm installer is maintained here. Package consumers retain wildcard peers. The development lockfile remains frozen and explicit. |
| Vulnerable brace-expansion resolution | `bun.lock` resolves the new direct dependency to `5.0.12`. |

## Anthropic native-gap boundary

Pi's OAuth conversion and reply dispatch fold tool names without preserving distinct case identities in inline updates. A post-conversion filter cannot distinguish a shadow addition from a genuine exact-name redefinition.

The adapter uses public `getDeclaredTools()` and changes only `supportsMidConvoToolChanges` on a request-local model copy. Pi still owns the original transcript, current tools, response dispatch, streaming, cancellation, retry, and accounting. The existing top-level filter retains the first active case-insensitive declaration.

The predicate includes removed historical declarations. A past collision can therefore keep the current-tool path selected after the collision disappears. This trades inline prompt-cache reuse for consistent tool identity. No cache speedup or production gateway acceptance is claimed.

A transcript projection was rejected because it adds a second tool-state replay mechanism. Both adapters can be deleted when Pi preserves first-active case-folded identity in declarations and reply dispatch.

## Verification evidence

The pre-change frozen install and `make verify` passed. New version and renderer regressions failed before their migrations. Anthropic transition regressions reproduced four wire mismatches before the capability choice. Writable uppercase-worker regressions failed before the native factories were added. Readonly behavior remained restricted to four tools.

The final frozen install, `make verify`, and post-migration progress TUI passed. The complete skin smoke suite, prompt parity, theme smoke, provider request-path probe, and four project CLI harness journeys passed. Independent DeepSeek code review found no confirmed defects. Its follow-up review confirmed the native worker fix and the three resolved trail flags.

The final V8 statement coverage results are:

| Package | Statements |
| --- | --- |
| `pi-pstack` | 80.30% |
| `pi-anthropic-oauth` | 100% |
| `pi-antigravity-oauth` | 97.10% |
| `pi-xai-oauth` | 98.91% |
| `pi-tui-skin` | 97.69% |
| `pi-one-dark-pro-theme` | 97.25% |

The existing pstack skip and two expected skin failures remain. No focused or skipped tests were added.

Local evidence is under `.audit/pi-1.0.1/`. The directory contains baseline, red, green, full verification, terminal, RPC, release audit, review, and append-only decision logs. Generated captures remain uncommitted. The substantive native-gap decisions and rerun commands are recorded here.

The existing run paths are:

```sh
bun install --frozen-lockfile
make verify
bun run --filter pi-pstack check:progress-tui
bun run --filter pi-tui-skin check:smoke
bun run --filter pi-one-dark-pro-theme check:smoke
(cd extensions/pi-tui-skin && node scripts/check-prompt-parity.mjs)
(cd extensions/pi-anthropic-oauth && node --experimental-strip-types scripts/prove-request-paths.ts)
```

The project verification harness also exercises `pstack-status`, `poteto-mode`, `standalone-skills`, and `oauth-providers` through real Pi processes. Each `drive` run follows `control-pi doctor` under `.pi/skills/verify-pi-customizations/bin/`.

## Verification limits

Provider wire tests use loopback fixtures and synthetic credentials. They do not establish acceptance by production Anthropic, Google, or Grok services. Native MCP OAuth registration against a remote authorization server was not exercised. No real credentials, deployments, or user data were changed.

Readonly workers have restricted tools, not an OS sandbox. Detached and remote workers retain CLI-owned builtin loading. This migration does not change their placement or isolation contract.
