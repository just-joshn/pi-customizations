# Repo map

The repo map tells the model which other files exist. `/map` prints it, `/map-refresh` rebuilds it, and every request carries it ahead of the chat files. Files already in the chat are left out of the map.

## Sub-features

- `map-print`: `/map` gives a notice that starts with `Here are summaries of some files present in my git repository.` and lists `app.py`, `util.py`, and `NOTES.md`, each on its own line.
- `map-excludes-chat`: after `/add app.py`, `/map` no longer lists `app.py`.
- `map-refresh`: `/map-refresh` gives the notice `The repo map has been refreshed, use /map to view it.`
- `map-context`: the next model request contains the map, including `util.py`.

## How to get to it (user POV)

- Type `/map` or `/map-refresh`. The map is sent automatically when `map-tokens` is non-zero.

## Driving it with control-maintainer

Preconditions:

- `doctor` passes. The drive commits a `util.py` on top of the seed repo, and the config has `map-tokens: 1024`.

Steps:

- **Run.** `./.pi/skills/verify-pi-maintainer/bin/control-maintainer drive repo-map`.
- **Act.** In RPC: `/map`, `/add app.py`, `/map`, `/map-refresh`, and the prompt `where is helper?`.
- **Observe.** The notices are as above. The last entry in `requests.jsonl` contains `util.py` in a user message.
- **Proof.** `artifacts/verify-pi-maintainer/repo-map/` holds `results.json` (both map texts and the refresh notice) and `requests.jsonl`.

## Gotchas

- With the scripted model and no `map-tokens`, `/map` prints `No repository map available.` Unknown models get no map budget.
- The map lists file names only. Production has no tree-sitter runtime (`unavailableQueryRuntime` in `src/map/query-runtime.ts`), so do not expect symbols such as `def greet` or `class Store`.
- Only git-tracked files appear. An untracked file is invisible to the map.
