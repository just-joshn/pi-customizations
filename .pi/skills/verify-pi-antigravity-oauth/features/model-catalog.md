# Model catalog

Pi lists Antigravity agent models, one per base id, with efforts mapped to thinking levels. Before the first networked refresh, the list comes from the bundled snapshot (`src/catalog-snapshot.ts`). When Pi refreshes catalogs over the network, the extension asks Cloud Code `fetchAvailableModels` for the account's models. Those replace the snapshot, so a snapshot model the account lacks disappears. Pi saves that list and uses it offline and in print and RPC mode, as `docs/providers.md` describes for live catalogs.

## Sub-features

- `catalog-snapshot`: `pi --offline --list-models google-antigravity` lists `claude-opus-5-5`, `claude-sonnet-5-5`, `gemini-3.1-pro`, `gemini-3.6-flash`, `gemini-3.7-flash`, `gemini-3.8-flash`, and `gpt-oss-120b`, and makes no Cloud Code call.
- `catalog-live`: opening `/model` in an online TUI calls `fetchAvailableModels` with `{"project":<projectId>}`, the agy user agent, and the bearer token. The selector then shows only the live models, as `<id> (<name> (Antigravity)) [google-antigravity]`.
- `catalog-saved`: after a live refresh, `pi --offline --list-models google-antigravity` lists the saved live models without a new `fetchAvailableModels` call.
- `catalog-effort-merge`: live ids `claude-sonnet-5-5-low` and `claude-sonnet-5-5-high` collapse into a single `claude-sonnet-5-5` row.

## How to get to it (user POV)

- `pi --list-models google-antigravity` (snapshot until the first networked refresh, then the saved live list).
- In interactive Pi, `/model` (refreshes over the network unless Pi runs with `--offline` or `PI_OFFLINE`).

## Driving it with control-antigravity-oauth

Preconditions:

- `doctor` passes, including the `tmux` check. The drive stores a credential with `projectId: verify-project-catalog`. Its peer serves a live catalog of `claude-sonnet-5-5-low`, `claude-sonnet-5-5-high`, and `gemini-9-flash-medium`.

Steps:

- **Run.** Run `./.pi/skills/verify-pi-antigravity-oauth/bin/control-antigravity-oauth drive model-catalog`.
- **Snapshot.** The drive runs `pi --offline --list-models google-antigravity`. The listed ids equal the `catalog-snapshot` list, and the peer saw zero requests (`list-models-offline.txt`).
- **Live.** The drive starts the TUI without `--offline`, types `/model`, presses Enter, and waits for `Model catalogs refreshed.`.
  - The pane shows `claude-sonnet-5-5` and `gemini-9-flash` rows tagged `[google-antigravity]`, and none of `claude-opus-5-5`, `gemini-3.1-pro`, or `gpt-oss-120b` (`model-selector.txt`).
  - `catalog.json` shows the `fetchAvailableModels` body, headers, and egress log. In the proven run the egress log was empty.
- **Saved.** The drive closes the TUI and runs `pi --offline --list-models google-antigravity` again. It lists exactly `claude-sonnet-5-5` and `gemini-9-flash`, and the peer saw no new request (`list-models-after-refresh.txt`).

## Gotchas

- `pi --list-models` never fetches, even without `--offline`. It shows whatever Pi last saved. Only the TUI `/model` selector and the post-login refresh in an online TUI call `fetchAvailableModels`. A fresh agent dir therefore lists the snapshot until one of those runs.
- The `!context.allowNetwork` branch in `createFetchModels` never runs through the provider, because `createProvider` calls `fetchModels` only when network is allowed and restores the saved list otherwise. Its unit test calls the function directly.
- The online TUI may try other providers' remote catalogs. The sink refuses them, and they would show up in `catalog.json` → `egress`. The drive fails only if a Google host appears there.
- `filterModels` drops snapshot models only when at least one live model exists. An empty live catalog keeps the snapshot. The drive does not cover that case.
- `scripts/snapshot-catalog.mjs` regenerates the snapshot. When it changes, update `SNAPSHOT_MODELS` in the harness.
