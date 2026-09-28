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
| Pinned copy | `OneDark-Pro-flat.json` in this directory |
| Bytes | 63665 |
| SHA-256 | `e9b4770f83a55891dcd208d7c599f2b0983c07fdcec40301249f50d0e023c656` |
| Contents | 246 `colors` keys, 277 `tokenColors` rules, 10 `semanticTokenColors` entries |

`scripts/check-parity.mjs` verifies the hash. A change to the pinned file fails the check until
the `UPSTREAM_SHA256` constant in `parity/theme.ts` matches, so upstream drift cannot pass silently.

## Why the file is `OneDark-Pro-flat.json` and not `OneDark-Pro.json`

The repository ships five variants under `themes/`: `OneDark-Pro.json`, `OneDark-Pro-flat.json`,
`OneDark-Pro-darker.json`, `OneDark-Pro-mix.json`, and `OneDark-Pro-night-flat.json`.
All five declare `"name": "One Dark Pro"` inside the file, so the file name is the only
unambiguous identifier. This package pins the `-flat` file.

## Refresh procedure

1. Download `https://raw.githubusercontent.com/Binaryify/OneDark-Pro/master/themes/OneDark-Pro-flat.json`.
2. Replace `upstream/OneDark-Pro-flat.json`.
3. Update the byte count, SHA-256, and commit hash in this table, and `UPSTREAM_SHA256` in
   `parity/theme.ts`. Those are the two places the pin lives.
4. Run `bun run build:theme` then `bun run check:parity`.
5. Review the diff in `themes/one-dark-pro-flat.json` before committing. A changed color in the
   output is a real change in what the user sees.
