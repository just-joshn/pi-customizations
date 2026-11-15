# pi-customizations

Extensions for [Pi](https://pi.dev), the coding agent by Earendil Works. Each one is a separate npm package listed on [pi.dev/packages](https://pi.dev/packages).

| Package | What it adds |
| --- | --- |
| [`@justjoshn/pi-anthropic-oauth-v2`](extensions/pi-anthropic-oauth-v2) | Claude models through your Claude subscription, plus `/claude-usage`. |
| [`@justjoshn/pi-google-oauth-v2`](extensions/pi-google-oauth-v2) | The Gemini and partner models your Google AI plan serves. |
| [`@justjoshn/pi-spacex-oauth-v2`](extensions/pi-spacex-oauth-v2) | Grok and Cursor models through your X subscription, plus `/spacex-usage`. |
| [`@justjoshn/pi-pstack-v2`](extensions/pi-pstack-v2) | The pstack workflows and skills, such as `/poteto-mode`, built on Pi's own tools. |

Install one with `pi install npm:<package>`.

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

```sh
bun install
bun run ci          # Biome lint and format check
bun run typecheck   # every package
bun run test        # every package
```

To load a package from this checkout, run `pi -e extensions/<package>`.

Bump `version` in a package's `package.json` and merge to `main` to publish it. See [`docs/releases.md`](docs/releases.md).

## License

[MIT](LICENSE)
