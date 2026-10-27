# pi-customizations

Extensions and skills for [Pi](https://pi.dev), the coding agent by Earendil Works. This repository is a personal setup, published as is. Every piece installs separately, so you can take one extension or all of them.

## What is inside

| Package | What it does |
| --- | --- |
| [`extensions/pi-pstack`](extensions/pi-pstack/README.md) | Ports the Cursor pstack 0.15.35 plugin to Pi 1.4.0: `/poteto-mode`, `/mode`, `/loop`, the `Task` subagent tool, `TodoWrite`, `AskQuestion`, and the always-applied model rule, with pstack's skills shipped as upstream wrote them. |
| [`extensions/pi-anthropic-oauth`](extensions/pi-anthropic-oauth/README.md) | Lets a Claude Pro or Max subscription answer in Pi through a separate `claude-subscription` provider. |
| [`extensions/pi-antigravity-oauth`](extensions/pi-antigravity-oauth/README.md) | Restores the `google-antigravity` provider. Signs in with Google OAuth and talks to the Cloud Code Assist API. |
| [`extensions/pi-xai-oauth`](extensions/pi-xai-oauth/README.md) | Lets a SuperGrok or X Premium subscription answer in Pi through the `grok-build` provider. |
| [`extensions/pi-maintainer`](extensions/pi-maintainer/README.md) | Aider-parity edit, git, map, and lint on Pi 1.1.0. Declares runtime npm dependencies (`yaml`, `ignore`, `diff-match-patch`), so the workspace install below is required before Pi can load it. |
| [`skills/port-harness-capability`](skills/port-harness-capability/) | Clean-room ports of capabilities from other AI coding harnesses, with a machine-checked parity ledger. |
| [`skills/reverse-engineer-anything`](skills/reverse-engineer-anything/) | A Pi-native reimplementation of [REA](https://github.com/morluto/rea)'s investigation contract: Evidence records, a session store, a residual-unknown registry, and engine-free analyzers for JavaScript/Electron apps and ASARs, archives, Mach-O/ELF/PE binaries, Go metadata and retained HAR captures. Local-only, no analysis engine, no npm dependency. |

## Install

Clone the repository, install workspace dependencies, then install a package from the checkout. Pi loads local packages in place and does not install their npm dependencies for you, so keep the clone where it is and run `bun install` after clone or pull.

```sh
git clone https://github.com/just-joshn/pi-customizations.git
cd pi-customizations
bun install
pi install ./extensions/pi-pstack   # or any other extension directory
```

The repository root is its own Pi package holding the standalone skill. Run `pi install .` from the clone root to install it. To update, run `git pull --ff-only` in the clone, then `bun install`, then `/reload` in Pi.

The OAuth extensions log you into paid subscriptions and send requests that identify as other clients. Read each extension's README before using one, and use them only with accounts you own.

## Verify

The Makefile drives every gate. From the repository root:

```sh
bun install
make verify
```

`make verify` covers lint, agent-compliance checks, Pi mechanism checks, toolchain checks, test conventions, each extension's suite, a fresh-install check, and the standalone skill's tests. It needs [bun](https://bun.sh) and Node 22.19 or newer.

The [Pi 1.0.2 migration audit](docs/pi-1.0.2-migration.md) records the package inventory, native API choices, verification paths, and remaining test limits. The [Pi 1.0.1 audit](docs/pi-1.0.1-migration.md) retains the previous migration's evidence.

## Repository notes

- `extensions/pi-pstack/upstream.lock.json` pins the MIT-licensed pstack plugin and the cursor-team-kit skills it depends on to an upstream commit, and `check:upstream` verifies every shipped file against that pin.
- `extensions/pi-antigravity-oauth` embeds the Google installed-app OAuth client that the Antigravity desktop app ships. Google treats an installed-app client secret as non-confidential, so the value is public by design and kept in plain sight in the source.
- Generated verification output lands in `artifacts/` and `.audit/`, both gitignored. Decision trails for past runs live in git history and in the extension docs.

## License

[MIT](LICENSE). Vendored upstream snapshots keep their own MIT license files.
