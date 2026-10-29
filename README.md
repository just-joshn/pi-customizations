# pi-customizations

Extensions for [Pi](https://pi.dev), the coding agent by Earendil Works. This repository is a personal setup, published as is. Every extension installs separately, so you can take one or all of them.

## What is inside

| Package | What it does |
| --- | --- |
| [`extensions/pi-pstack`](extensions/pi-pstack/README.md) | pstack 0.15.36 for Pi: the `/poteto-mode` workflows and principle skills, plus the host features they call: `/mode`, `/plan`, `/loop`, the `Task` subagent tool, `TodoWrite`, `AskQuestion`, the model rule, subscriptions, and `visualize`. |
| [`extensions/pi-anthropic-oauth`](extensions/pi-anthropic-oauth/README.md) | Lets a Claude Pro or Max subscription answer in Pi through a separate `claude-subscription` provider. |
| [`extensions/pi-antigravity-oauth`](extensions/pi-antigravity-oauth/README.md) | Restores the `google-antigravity` provider. Signs in with Google OAuth and talks to the Cloud Code Assist API. |
| [`extensions/pi-xai-oauth`](extensions/pi-xai-oauth/README.md) | Lets a SuperGrok or X Premium subscription answer in Pi through the `grok-build` provider. |
| [`extensions/pi-maintainer`](extensions/pi-maintainer/README.md) | Aider's edit formats, git integration, repository map, and lint and test loop, rebuilt on Pi's extension API. Declares runtime npm dependencies (`yaml`, `ignore`, `diff-match-patch`), so the workspace install below is required before Pi can load it. |
| [`extensions/pi-rea`](extensions/pi-rea/README.md) | REA (Reverse Engineer Anything) for Pi: REA's tool contract, its Evidence and session kernel, its workflow skill, and its prompt templates. Declares a runtime npm dependency (`@babel/parser`). |

## Install

Clone the repository, install workspace dependencies, then install a package from the checkout. Pi loads local packages in place and does not install their npm dependencies for you, so keep the clone where it is and run `bun install` after clone or pull.

```sh
git clone https://github.com/just-joshn/pi-customizations.git
cd pi-customizations
bun install
pi install ./extensions/pi-pstack   # or any other extension directory
```

To update, run `git pull --ff-only` in the clone, then `bun install`, then `/reload` in Pi.

The OAuth extensions log you into paid subscriptions and send requests that identify as other clients. Read each extension's README before using one, and use them only with accounts you own.

## Verify

The Makefile drives every gate. From the repository root:

```sh
bun install
make verify
```

`make verify` runs Biome, the Pi package-mechanism check, the bun toolchain check, the Vitest conventions check from [`AGENTS.md`](AGENTS.md), every extension's typecheck and test suite with coverage, the OAuth extensions' offline proof scripts, and a fresh-install check. It needs [bun](https://bun.sh) and Node 22.19 or newer. Every extension targets Pi 1.4.0.

## Repository notes

- `extensions/pi-antigravity-oauth` embeds the Google installed-app OAuth client that the Antigravity desktop app ships. Google treats an installed-app client secret as non-confidential, so the value is public by design and kept in plain sight in the source.
- Generated verification output lands in `artifacts/` and `.audit/`, both gitignored. Parity records and captured upstream evidence live in `parity/`. Decision trails for past runs live in git history and in the extension docs.

## License

[MIT](LICENSE). Vendored upstream snapshots keep their own MIT license files.
