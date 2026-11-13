---
name: verify-pi-maintainer
description: "Verify the pi-maintainer extension (extensions/pi-maintainer, Aider's editing rebuilt on Pi) through the installed pi CLI in print and RPC modes: reply-text edits (whole-file and SEARCH/REPLACE) with auto-commit, chat files (/add, /read-only, /drop, /reset), git commands (/diff, /undo, /commit, /git), the repo map (/map, /map-refresh), and lint/test (/lint, /test), all against a scripted model in a scratch git repo. Use after changing extensions/pi-maintainer, before releasing it, or when a maintainer user reports an edit, git, map, or lint regression."
---

# Verify pi-maintainer

Drive `extensions/pi-maintainer` the way a user does. The installed `pi` CLI loads the package from `settings.json` `packages` (what `pi install ./extensions/pi-maintainer` writes). Session start switches the session model to the `pi-maintainer/coder` router, which routes every turn to the physical model the user picked. The harness drives Pi in `--print` and `--mode rpc`. The only fake is that physical model: `scripted/coder` (`bin/scripted-coder.ts`). Its reply is the JSON string on a `@@reply <json>` line of the prompt, and it answers every commit-message request with `feat: scripted edit`. It logs each request's full context to `requests.jsonl`. No drive reaches a real model, the network, `~/.pi/agent`, or your git identity.

Read `features/README.md` before driving, then the feature file for the behavior you need to prove.

## Launch

Pi is a short-lived CLI, so there is no server to keep alive. One-time setup from the repo root:

```bash
bun install
```

This step is required. Pi loads the package from the checkout and does not install its dependencies (`yaml`, `ignore`, `diff-match-patch`). A missing dependency fails at load with `Cannot find module 'yaml'`.

Each drive creates `$TMPDIR/verify-pi-maintainer-*/` containing:

- `agent/`: `PI_CODING_AGENT_DIR`, with `settings.json` = `{packages: [<repo>/extensions/pi-maintainer], extensions: [<skill>/bin/scripted-coder.ts], quietStartup: true}`.
- `home/`: `HOME`. It holds a `.gitconfig` with a fake identity and `init.defaultBranch = main`, so commits work and the user's global git config stays out.
- `work/`: the cwd of every Pi process. It is a git repo with one commit, `init`, of `app.py`, `NOTES.md`, and a `.gitignore` of `.pi-maintainer*`. It also holds an ignored `.pi-maintainer.conf.yml` (`yes-always: true`, `edit-format: diff`, `map-tokens: 1024`). Some drives rewrite that config.
- `log/requests.jsonl`: one line per model request: `kind` (`scripted`, `commit`, or `default`), `tools`, every message's text, and the reply.
- `run.json`: the Pi PIDs this run started.

Every Pi process runs as `pi --offline --provider scripted --model coder --print --no-session <prompt>` or `... --mode rpc --no-session`. The environment sets `PI_OFFLINE=1` and `PI_SKIP_VERSION_CHECK=1`, and removes every inherited `PI_CODING_AGENT*`, `PI_SESSION*`, `PI_PSTACK_*`, `PSTACK_*`, `PI_MAINTAINER_*`, `AIDER_*`, `GIT_*`, `PI_MODEL`, `PI_PROVIDER`, and `PI_REASONING_LEVEL`. Inside a Pi chat those variables are set and would leak your session, or maintainer settings, into the child.

Ready means:

- Print mode: the process exits 0. Maintainer notices (`Commit <hash> <subject>`, warnings) are on stderr.
- RPC mode: `get_state` reports model `pi-maintainer/coder`. After that, a slash command answers `data.disposition: "handled"` once it finishes, and a prompt's turn ends with `agent_settled`. Notices arrive as `extension_ui_request` with `method: "notify"`.

Teardown happens in each drive's `finally`. The harness closes the RPC child's stdin (SIGKILL after 5 s), then SIGKILLs the process group of every PID in `run.json` and removes the scratch dir.

## Doctor

Run this first, and again whenever a drive fails strangely:

```bash
./.pi/skills/verify-pi-maintainer/bin/control-maintainer doctor
```

It checks Node `>= 22.19.0` (the package's `engines`), `pi --version` (drives pass on 1.5.2), `git`, the extension entry, its three runtime dependencies, and the scripted model. It then opens a scratch RPC session and checks that the session model is `pi-maintainer/coder`, that `add drop read-only reset undo git commit diff map map-refresh lint test` are registered extension commands, and that there was no `extension_error`. Last, it checks that no scratch runs are left over. It prints which inherited variables the drives remove. It exits `1` on any failure.

## Drive

```bash
B=./.pi/skills/verify-pi-maintainer/bin/control-maintainer
$B drive edit        # print: whole-file edit + auto-commit; RPC: /add + SEARCH/REPLACE + auto-commit
$B drive chat-files  # RPC: /add, /read-only, /drop, /reset and what reaches the model context
$B drive git         # RPC: assistant commit, /diff, /undo, /commit, /git
$B drive repo-map    # RPC: /map, chat files leave the map, /map-refresh, map in model context
$B drive lint-test   # RPC: /test pass and fail (output becomes a turn), /lint with a lint-cmd
$B drive all         # every feature in turn; exits 1 if any fails
```

Flags: `--out <dir>` writes evidence elsewhere. `--keep` keeps the scratch dir (processes are still killed) and prints its path as `scratch`. Use it to inspect `work/` or `log/requests.jsonl`, then remove kept dirs with `cleanup`.

Each drive prints a JSON report and exits `0` or `1`. The report has `status` (`PASS` or `FAIL`), `piVersion`, `platform`, `evidence`, `summary`, and the first failed assertion with its stack in `error`.

To drive something by hand, copy the pattern: build a scratch dir like the one above, use the scrubbed environment, and send prompts whose second line is `@@reply <JSON string>`. In JavaScript that is `` `ask\n@@reply ${JSON.stringify(replyText)}` ``. The reply must be in the edit format the config selects. An unknown model defaults to `whole`, so a SEARCH/REPLACE reply needs `edit-format: diff`. Keep the directive off the first line, because Pi reads a first-line `@x` argument as a file. Send RPC commands one at a time and wait for each response: maintainer commands throw `Maintainer commands require an idle session` while a turn runs. Never point a manual run at `~/.pi/agent` or a repo you care about. A maintainer session auto-commits.

## Evidence

Each drive replaces `artifacts/verify-pi-maintainer/<feature>/`, which is gitignored. Every drive writes these files:

- `run.json`: the report.
- `rpc.events.jsonl`: the raw RPC event stream.
- `requests.jsonl`: the model requests, with full context.
- `git-log.txt`: `git log --stat` of the scratch repo at the end.
- `app.py.final`: the edited file.
- `stderr.txt`: Pi's stderr.
- `results.json`: the notices each step asserted on.

The edit drive also writes `print.stderr.txt` and `print.stdout.txt`.

Proof standards:

- Drive the real user paths: `pi --print` and `pi --mode rpc` with the package installed through `settings.json`, and slash commands typed as `prompt` messages. Do not import extension modules or call `test/` helpers.
- The scripted model is the only fake. It sits behind the `pi-maintainer/coder` router at the provider boundary. The edit parser, file writes, git commits, map, lint, and test runs are all real.
- Assert side effects, not just notices: file contents on disk, `git log` subject and `Co-authored-by: pi (coder) <noreply@pi.dev>` trailer, HEAD movement, a clean `git status`, and what the next model request actually contained.
- Scope: these drives do not prove TUI rendering, confirm dialogs (every run sets `yes-always: true`), real-model edit quality, tree-sitter tags in the map (production has no tree-sitter runtime, so the map lists file names only), `/architect` and `/ask` modes, `--watch-files`, or settings precedence across `.env`, environment, and flags. See "Not mapped yet" in `features/README.md`.
- The package's own `bun run journey:edit` (`parity/journeys/edit/`) covers the same edit path. It refuses any Pi other than the devDependency version (1.5.0) and fails on the installed 1.5.2. This skill has no such pin.

## Cleanup

Drives clean up after themselves even when they fail. For a kept or interrupted run:

```bash
./.pi/skills/verify-pi-maintainer/bin/control-maintainer cleanup
```

`cleanup` reads each `$TMPDIR/verify-pi-maintainer-*/run.json`, SIGKILLs the process groups of the recorded Pi PIDs, and removes the directory. It never kills by process name and never touches `artifacts/verify-pi-maintainer/`.

## Helpers

- `bin/control-maintainer` is an executable Node script that needs only Node, `git`, and `pi`. Its subcommands are `doctor`, `drive <edit|chat-files|git|repo-map|lint-test|all> [--out <dir>] [--keep]`, and `cleanup`. To add a feature, write a `drive<Name>(run, out)` function, register it in `DRIVES` and `FEATURES`, and add a feature file. `rpc.type(message, { turn })` types a prompt or command and returns its `notices`. Pass `turn: true` for a command that starts a model turn, such as a failing `/test`.
- `bin/scripted-coder.ts` is the `scripted/coder` provider. Pi loads it as an extension through the scratch `settings.json`. It is not a standalone script.
