# pi-customizations

Extensions, themes, and skills for [Pi](https://pi.dev), the coding agent by Earendil Works. This repository is a personal setup, published as is. Every piece installs separately, so you can take one extension or all of them.

## What is inside

| Package | What it does |
| --- | --- |
| [`extensions/pi-pstack`](extensions/pi-pstack/README.md) | Ports the pstack 0.15.7 workflow plugin and team-kit 1.2.0 to Pi 1.0.0. 69 prompt templates and 71 skills, including `/poteto-mode`, plus an extension that supplies executable behavior. See its [latest parity audit](extensions/pi-pstack/docs/latest-parity.md), including external-service and proprietary-host limits. |
| [`extensions/pi-anthropic-oauth`](extensions/pi-anthropic-oauth/README.md) | Lets a Claude Pro or Max subscription answer in Pi through a separate `claude-subscription` provider. |
| [`extensions/pi-antigravity-oauth`](extensions/pi-antigravity-oauth/README.md) | Restores the `google-antigravity` provider. Signs in with Google OAuth and talks to the Cloud Code Assist API. |
| [`extensions/pi-xai-oauth`](extensions/pi-xai-oauth/README.md) | Lets a SuperGrok or X Premium subscription answer in Pi through the `grok-build` provider. |
| [`extensions/pi-tui-skin`](extensions/pi-tui-skin/README.md) | A presentation-only skin that makes the Pi TUI look like the reference-agent TUI. Ships captured reference frames and comparison tooling. |
| [`extensions/pi-one-dark-pro-theme`](extensions/pi-one-dark-pro-theme/README.md) | One Dark Pro Flat theme for Pi, computed from the pinned VS Code theme file. |
| [`skills/`](skills/) | Five standalone skills: `doctor`, `run`, `simplify`, `reverse-engineer-cli`, `implement-cli-from-contract`. |

## Install

Clone the repository, then install a package from the checkout. Pi loads local packages in place, so keep the clone where it is.

```sh
git clone https://github.com/just-joshn/pi-customizations.git
cd pi-customizations
pi install ./extensions/pi-pstack   # or any other extension directory
```

The repository root is its own Pi package holding the five standalone skills. Run `pi install .` from the clone root to install those. To update, run `git pull --ff-only` in the clone, then `/reload` in Pi.

The OAuth extensions log you into paid subscriptions and send requests that identify as other clients. Read each extension's README before using one, and use them only with accounts you own.

## Verify

The Makefile drives every gate. From the repository root:

```sh
bun install
make verify
```

`make verify` covers lint, agent-compliance checks, Pi mechanism checks, toolchain checks, test conventions, each extension's suite, a fresh-install check, and Python coverage for the standalone skills. It needs [bun](https://bun.sh), Node 22.19 or newer, and [uv](https://docs.astral.sh/uv/). Two targets need more and stay out of the default set: `make sweep-tui-skin` needs tmux, a real Pi binary, and an installed reference-agent, and `make verify-parity-audit` needs a preserved upstream checkout.

## Repository notes

- `extensions/pi-pstack/upstream/` and `extensions/pi-pstack/upstream-team-kit/` are vendored snapshots of the MIT-licensed pstack and team-kit plugins. Their license files travel with them, and parity checks compare the port against these pins.
- `extensions/pi-antigravity-oauth` embeds the Google installed-app OAuth client that the Antigravity desktop app ships. Google treats an installed-app client secret as non-confidential, so the value is public by design and kept in plain sight in the source.
- Raw terminal captures under `extensions/pi-tui-skin/reference/` are byte-for-byte tmux captures and may show the machine path they were taken on. The sanitized `.txt` baselines that the comparison gates read do not.
- Generated verification output lands in `artifacts/` and `.audit/`, both gitignored. Decision trails for past runs live in git history and in the extension docs.

## License

[MIT](LICENSE). Vendored upstream snapshots keep their own MIT license files.
