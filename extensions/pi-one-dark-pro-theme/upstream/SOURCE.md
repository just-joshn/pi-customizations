# Upstream source of truth

This package maps Pi's theme roles onto the Visual Studio Code theme **One Dark Pro Flat**.
Every color in `themes/one-dark-pro-flat.json` is computed from the file pinned in this directory.

| Field | Value |
|---|---|
| Repository | https://github.com/Binaryify/OneDark-Pro |
| Path | `themes/OneDark-Pro-flat.json` |
| Theme name inside the file | `One Dark Pro` |
| Theme type | `dark` |
| Last commit touching the file | `98a63df095089222a0300ccd64f3523465d7c827` (2026-08-13) |
| Original bytes | `originalSource` string in `provenance.json` |
| Policy-formatted artifact | `OneDark-Pro-flat.json` in this directory |
| Original byte count | 63665 |
| SHA-256 | `e9b4770f83a55891dcd208d7c599f2b0983c07fdcec40301249f50d0e023c656` |
| Contents | 246 `colors` keys, 277 `tokenColors` rules, 10 `semanticTokenColors` entries |

`scripts/check-parity.mjs` verifies the SHA-256 of the decoded `originalSource` string against
`UPSTREAM_SHA256` in `parity/theme.ts`. The constant remains the authentic upstream byte pin.
The checker also runs the repository's installed Biome formatter with the shared root policy.
`OneDark-Pro-flat.json` must match that transform byte for byte, including whitespace.
The theme build in the parity check uses the authenticated original source.

The JSON envelope lets Biome format provenance without changing the original source bytes.
No raw JSON file bypasses the shared policy. Both semantic artifact drift and whitespace drift
fail parity. Whitespace normalization during replay is intentional, but a whitespace change
inside `originalSource` still fails the original hash check.

To reproduce the artifact without changing the checkout, run from this package directory:

```bash
node scripts/replay-upstream.mjs > /tmp/one-dark-pro-flat.replayed.json
cmp upstream/OneDark-Pro-flat.json /tmp/one-dark-pro-flat.replayed.json
```

Replay verifies the original pin before emitting output. The formatter boundary uses the
repository root's `node_modules/.bin/biome` and discovers its shared configuration from that root.
Verification and replay require this repository's installed development dependencies.

## Why the file is `OneDark-Pro-flat.json` and not `OneDark-Pro.json`

The repository ships five variants under `themes/`: `OneDark-Pro.json`, `OneDark-Pro-flat.json`,
`OneDark-Pro-darker.json`, `OneDark-Pro-mix.json`, and `OneDark-Pro-night-flat.json`.
All five declare `"name": "One Dark Pro"` inside the file, so the file name is the only
unambiguous identifier. This package pins the `-flat` file.

## Refresh procedure

1. Download `https://raw.githubusercontent.com/Binaryify/OneDark-Pro/master/themes/OneDark-Pro-flat.json`.
2. Encode the downloaded UTF-8 bytes as the `originalSource` JSON string in `upstream/provenance.json`.
   Do not use the policy-formatted artifact as the original source.
3. For an intentional upstream update, update the original byte count, SHA-256, and commit hash
   in this table, and `UPSTREAM_SHA256` in `parity/theme.ts`.
4. Format the provenance envelope with the shared root Biome configuration.
5. Run `node scripts/replay-upstream.mjs > /tmp/one-dark-pro-flat.replayed.json && cp /tmp/one-dark-pro-flat.replayed.json upstream/OneDark-Pro-flat.json`.
6. Run `bun run build:theme` then `bun run check:parity`.
7. Review both the decoded source and the theme diff before committing. A changed output color
   changes what the user sees.
