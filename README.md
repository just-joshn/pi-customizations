# pi-customizations

Packages for [Pi](https://pi.dev), the coding agent by Earendil Works. Each one is a separate npm package listed on [pi.dev/packages](https://pi.dev/packages).

| Package | What it adds |
| --- | --- |
| [`@justjoshn/pi-anthropic-oauth-v2`](extensions/pi-anthropic-oauth-v2) | Claude models through a custom Anthropic provider built on `@anthropic-ai/sdk`, with Claude Pro/Max sign-in or an API key. |
| [`@justjoshn/pi-google-oauth-v2`](extensions/pi-google-oauth-v2) | Gemini models through your Google AI plan, with Google account sign-in and no API key. |
| [`@justjoshn/pi-spacex-oauth-v2`](extensions/pi-spacex-oauth-v2) | Your X subscription through Grok Build and Cursor sign-ins, plus `/spacex-usage`. |
| [`@justjoshn/pi-pstack-v2`](extensions/pi-pstack-v2) | The pstack workflows and skills, started with `/pstack-mode poteto-mode`. It also adds the `tmux_run` and `tmux_jobs` tools, the `subagent` and `report_findings` tools, and a Gondolin VM that runs Pi's file and shell tools. |
| [`@justjoshn/pi-pstack-team-kit`](extensions/no-ceilings/pi-pstack-team-kit) | Pi-native pstack 0.15.46 and team kit 1.2.0 skills, principles, playbooks, agents, and rules. Start with `/skill:poteto-mode`; install the companions below for the tools its workflows call. |
| [`@justjoshn/pi-subagents`](extensions/no-ceilings/pi-subagents) | The `task` and `await_subagent` tools, custom agent discovery, nested tasks, and the `/tasks` overlay. |
| [`@justjoshn/pi-modes`](extensions/no-ceilings/pi-modes) | Agent, Plan, Debug, and Ask modes, with `switch_mode`, `ask_question`, and `create_plan`. |
| [`@justjoshn/pi-goals`](extensions/no-ceilings/pi-goals) | Durable `/goal` objectives that continue while idle, with `create_goal` and `update_goal`. |
| [`@justjoshn/pi-snoop-tui`](extensions/pi-snoop-tui) | Paired themes, compact tool rows, a single-line footer, and a static working indicator. |

The `no-ceilings` packages in `extensions/no-ceilings/` are one suite. The team kit supplies the skills, and the other three supply the tools those skills call.

Install a package with `pi install npm:<package>`.

## Deprecated packages

These packages get no more updates. Each one shows a notice in Pi with the commands to switch.

| Deprecated | Replacement |
| --- | --- |
| `@justjoshn/pi-anthropic-oauth` | `@justjoshn/pi-anthropic-oauth-v2` |
| `@justjoshn/pi-antigravity-oauth` | `@justjoshn/pi-google-oauth-v2` |
| `@justjoshn/pi-x-subscription-oauth` | `@justjoshn/pi-spacex-oauth-v2` |
| `@justjoshn/pi-pstack` | `@justjoshn/pi-pstack-v2` |
| `@justjoshn/pi-maintainer` | None |
| `@justjoshn/pi-rea` | None |

A replacement is a separate package, so `pi update` never moves you to it. Install the replacement, then remove the old package:

```sh
pi install npm:@justjoshn/pi-anthropic-oauth-v2
pi remove npm:@justjoshn/pi-anthropic-oauth
```

The source of the deprecated packages stays in git history.

## Develop

You need Node `>=22.19.0` and Bun. The `pi-pstack-v2` tests also need `tmux`.

```sh
bun install
bun run ci                   # Biome format and assist check, bun lint
bun run typecheck            # every package
bun run test                 # every package
```

`bun lint` exists only in Bun canary builds. Run `bun upgrade --canary` to get one. The CI lint job installs Bun canary (`bun-version: canary`). The CI test jobs and the release workflow use Bun 1.4.5.

To load a package from this checkout, run `pi -e extensions/<package>` for a top-level package or `pi -e extensions/no-ceilings/<package>` for a suite package.

Merging a `version` bump under `extensions/*/package.json` or `extensions/no-ceilings/*/package.json` to `main` triggers `.github/workflows/release.yml` (OIDC-only direct `npm publish`). See [`docs/releases.md`](docs/releases.md) for package release and publishing policy.

## License

[MIT](LICENSE)
