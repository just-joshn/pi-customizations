# pi-maintainer verification map

This directory is the maintained source for verifying the user-facing behavior of the `pi-maintainer` extension. Read this index before driving, then use the matching feature file as the recipe.

## Baseline preconditions

- Run `bun install` at the repo root once, and again after every `git pull`.
- `./.pi/skills/verify-pi-maintainer/bin/control-maintainer doctor` passes.
- Drives use the installed `pi` on `PATH` (proven on 1.5.2, macOS arm64). They load the package from the working tree through a scratch `settings.json` `packages` entry.
- The harness creates the scratch agent dir, HOME with a fake git identity, and a one-commit git repo as cwd. It also scrubs inherited `PI_*`, `PSTACK_*`, `PI_MAINTAINER_*`, `AIDER_*`, and `GIT_*` variables. Do not pre-seed anything, and never drive `~/.pi/agent` or a real repo. Maintainer sessions auto-commit.

## Driving conventions

- Use `control-maintainer drive <feature>` for every mapped drive.
- The physical model is `scripted/coder`. A prompt whose second line is `@@reply <JSON string>` gets exactly that reply. Any commit-message request gets `feat: scripted edit`, and anything else gets `ok`.
- The session model is the `pi-maintainer/coder` router. It is never `scripted/coder` directly, and `get_state` proves the router took over.
- Settings come from `work/.pi-maintainer.conf.yml`, which is gitignored by the seed `.gitignore`. Every drive sets `yes-always: true`, so no confirm dialog appears.
- In RPC, type slash commands as `prompt` messages, one at a time. Notices are `extension_ui_request` `notify` events; match them by exact text.
- Prove context claims from `log/requests.jsonl` (saved as `requests.jsonl`). It shows exactly what pi-maintainer sent the model.

## Proof and skip reporting

- Evidence goes to `artifacts/verify-pi-maintainer/<feature>/`. `run.json` holds the status, Pi version, platform, summary, and first failed assertion.
- A proof includes the notice text, the on-disk effect (file contents, `git log`, `git status`), and, for context behavior, the next model request.
- Report which entry point you drove. Print and RPC are separate entry points. The interactive TUI is a third, and no drive covers it.

## Not mapped yet (report as unverified)

- **TUI**: confirm dialogs (`yes-always` unset), autocomplete of `/add` paths, and the `pi-maintainer.state` entry renderer.
- **Chat modes**: `/ask`, `/code`, `/architect` (editor model hand-off), `/context`, `/model`, `/editor-model`, `/weak-model`, and `/tokens`.
- **`/save` and `/load`**, **`--watch-files`** AI comments, **`--dry-run`**, `--apply`, `--message-file`, and **automatic post-edit lint and test** with reflection (`auto-lint`, `auto-test`).
- **Edit formats** other than `whole` and `diff`: `udiff`, `diff-fenced`, and `patch`.
- **Settings precedence**: `.env`, `PI_MAINTAINER_*` environment, CLI flags, and `~/.pi-maintainer.conf.yml`.
- **Tree-sitter tags in the repo map.** The production query runtime is `unavailableQueryRuntime`, so maps list file names only.
- **Real-model behavior**: drives never use a real model.

## Feature entry contract

Each feature file starts with an H1 title and one paragraph that describes the user-visible behavior. Four H2 sections follow, in this order:

1. `Sub-features`: short IDs, one line per behavior.
2. `How to get to it (user POV)`: every entry point a user has.
3. `Driving it with control-maintainer`: starts with `Preconditions:`, then pairs each user action with the exact command or prompt and the observable result.
4. `Gotchas`: traps that can waste a verification run or invalidate it.

## Features

- [Edit](./edit.md): a reply-text edit applied to disk and auto-committed with a model-written message and `Co-authored-by` trailer, in print (whole-file) and RPC (SEARCH/REPLACE).
- [Chat files](./chat-files.md): `/add`, `/read-only`, `/drop`, and `/reset`, and which file contents and history reach the model.
- [Git commands](./git.md): `/diff`, `/undo`, `/commit`, and `/git`.
- [Repo map](./repo-map.md): `/map` and `/map-refresh`, chat files left out of the map, and the map in the model context.
- [Lint and test](./lint-test.md): `/test` with passing and failing commands, failing output sent to the model, and `/lint` with a configured `lint-cmd`.
