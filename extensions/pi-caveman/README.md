# pi-caveman

This Pi package brings [Caveman](https://github.com/JuliusBrussee/caveman) to Pi. The agent answers in a terse caveman voice: answer first, filler gone, every technical fact kept. Code, commands, paths, and error strings stay exact. The package tracks upstream commit `99aafe1` (see `UPSTREAM.json`): the agent-side plugin ported to Pi mechanisms, plus upstream's own Pi runtime for proxy routing and exact recovery.

## Use it

From this directory:

```bash
pi -e .
```

To keep it for every session, run `pi install` with the path to this directory. A fresh session starts in `caveman` mode, and the footer shows `[CAVEMAN]`. Say `stop caveman` or `normal mode` to turn it off.

## Commands

| Command | What it does |
|---|---|
| `/caveman [ultra\|wenyan\|off\|status]` | Turns on the caveman voice. `ultra` and `wenyan` are aliases for `/ultracave` and `/megacave`. Legacy names `lite`, `full`, and `wenyan-*` still resolve. |
| `/ultracave [off\|status]` | Maximum compression: fragments, each fact once. |
| `/megacave [off\|status]` | Caveman in Classical Chinese (文言文). Technical terms stay verbatim. |
| `/caveman-commit [context]` | One Conventional Commits message for the staged changes. One-shot. |
| `/caveman-review [target]` | Code review with one line per finding. One-shot. |
| `/caveman-compress <file>` | Compresses a memory file in place through the `caveman_compress` tool. One-shot. |
| `/caveman-stats [--share\|--all\|--since 7d]` | Output and cache-read tokens for this session, attributed to each mode. |
| `/caveman-help` | The quick-reference card. |
| `/caveman-init [--dry-run\|--force]` | Runs upstream's `caveman-init.js` to write rule files for other IDE agents. |

Natural language works too. `talk like caveman`, `be terse`, and `less tokens` turn the voice on. `stop caveman`, `turn off caveman`, and `normal mode` turn it off. The parser is a port of upstream's `caveman-parse.js`, so quoted text, questions, and negated phrases such as `don't use caveman` do not trigger it.

A one-shot command remembers the mode it displaced. The next ordinary prompt returns to that mode, or to off.

## Default mode

The first source that sets a valid `defaultMode` wins:

1. The `CAVEMAN_DEFAULT_MODE` environment variable.
2. `.caveman/config.json` or `.caveman.json` in the working directory or the nearest ancestor that has one.
3. `$XDG_CONFIG_HOME/caveman/config.json`, or `~/.config/caveman/config.json` (`%APPDATA%\caveman\config.json` on Windows).
4. `caveman`.

`manual` starts sessions off but lets a bare `/caveman` turn the voice on. `off` starts sessions off and also stops the ruleset and reminder from reaching the model. These are the same files that upstream Caveman reads, so one config serves both.

## How it maps onto Pi

| Upstream (Claude Code) | Pi |
|---|---|
| Mode flag files under `~/.claude/.caveman-sessions/` | `caveman-mode` session entries written with `pi.appendEntry()`. The mode follows the active branch and survives `/reload`, `--continue`, `/fork`, and compaction. An explicit off is never undone. |
| `SessionStart` hook injecting the skill, and the tracker re-injecting it on a mode switch | A `caveman` system prompt section set in `before_agent_start`. Pi sends the system prompt with every request, so the ruleset is always present rather than only after start, compaction, and switches. Compaction cannot drop it. |
| `UserPromptSubmit` mode tracker and per-turn reminder | The `input` handler parses mode changes. A hidden `caveman-context` message carries the reminder and any notice for that turn. |
| `caveman-statusline.sh` badge | `ctx.ui.setStatus('caveman', …)`. The badge shows `[CAVEMAN]`, `[ULTRACAVE]`, `[MEGACAVE]`, or `[CAVEMAN:COMMIT]`, and nothing when off. |
| `caveman-stats.js` reading Claude transcripts | `/caveman-stats` reads Pi's recorded usage on the active branch. Lifetime history goes to `~/.pi/agent/caveman/history.jsonl`. |
| `caveman-compress` Python scripts calling the `claude` CLI | The `caveman_compress` tool. It is a TypeScript port of `detect.py`, `validate.py`, and `compress.py`, and it calls the current model through `ctx.modelRegistry`. |
| `cavecrew-*` Claude subagents | The `cavecrew` tool. It runs `investigator`, `builder`, or `reviewer` in an isolated `pi --mode json` process with the upstream agent prompt. The model comes from `CAVECREW_<ROLE>_MODEL` first. Next comes the agent's upstream `model: haiku` hint when Pi has a model whose id contains `haiku`. Otherwise the subagent uses the session model. |
| Skills | All 22 upstream skills ship under `skills/`. `cavecrew`, `caveman-compress`, `caveman-help`, and `caveman-stats` come from `overrides/` because their upstream text names Claude Code mechanics. |

## Divergence from upstream

Upstream's sensitive-path check never matches `.ssh`, `.aws`, `.gnupg`, `.kube`, or `.docker`, because it compares dot-stripped names against dotted ones. `caveman_compress` refuses files under those directories. This is stricter than upstream and fixes a security gap. `docs/agents-audit.md` records the full rule-by-rule audit.

## Native runtime

The package also carries upstream's own Pi runtime (`@caveman-ai/pi`), vendored unchanged under `vendor/caveman/` and started from `src/runtime.ts`. With the Caveman CLI and its local binaries installed (`npm i -g @caveman-ai/cli`, then `caveman setup --install`), it does four things:

- It routes the selected model through the local `caveman-proxy` at `/w/pi`, but only after the proxy proves its identity and recovery is available. OAuth models, unknown endpoints, and endpoints whose headers or cache keys cannot be preserved stay direct.
- It registers `caveman_retrieve`, which returns the exact original bytes behind a `ccr_` handle.
- It shrinks large tool results only after the handle verifies against the original. Recovered output is never shrunk again.
- It forwards Pi lifecycle events to `caveman native-hook pi`, which adds Core and the task-classified skills (`surgical-patch`, `investigate-first`, `migration`, `safe-refactor`, `verify-and-stop`, `lean-build`) to the system prompt.

Without the CLI, or with the proxy down, stale, or answering with another identity, the session stays direct. Pi prints one `Caveman: direct mode, no compression this session` line and tool output stays untouched.

`caveman wrap pi` and `caveman enable pi` load their own copy of the same runtime. Pi refuses a second `caveman_retrieve`, so the package yields to the CLI's copy and keeps its ruleset in the prompt that copy writes. If the CLI's copy does not load, for example under `pi --no-extensions`, the package says so instead of failing silently.

Known upstream defect: the pinned engine panics on a bare numeric listing such as `seq 1 1500` (`engine/filewrap.go:35`), which takes the proxy down mid-session. The package cannot fix that.

## Update from upstream

```bash
git clone https://github.com/JuliusBrussee/caveman /tmp/caveman
bun run sync:upstream /tmp/caveman
bun run vendor /tmp/caveman
```

`scripts/sync-upstream.mjs` copies the skills and cavecrew agents, drops frontmatter fields that Pi does not read, applies `overrides/`, and records the commit in `UPSTREAM.json`.

## Verify

```bash
bun run test
bun run typecheck
bun run test:runtime                      # upstream's runtime suite on the vendored source
bun run check:parity:final                # parity ledger gate (needs /tmp/caveman at the pin)
node scripts/rpc-smoke.mjs --model <provider/id>
node scripts/e2e-real.mjs --cli <dir with caveman> --bin <dir with caveman-proxy>
```

`parity/ledger.json` lists every upstream capability, its Pi mechanism, and the tests that prove it. `check-parity.mjs` fails when an upstream skill, command, hook, agent, CLI verb, runtime event, top-level component, package, or documented `CAVEMAN_*` variable has no row, when the installed Pi packages differ from the ledger's host pin, when the package source opens its own network connection, when a cited test or source path is missing, when skills or the vendored runtime drift from the pin, or when `npm pack` would ship without a runtime file. `e2e-real.mjs` drives the package against the real `caveman-proxy`, `caveman-mcp`, and `caveman native-hook`, including parallel and MCP tool results and the `shrink`, `mem`, and `browse` services from Pi's bash tool. Rows marked `out-of-scope` (browser extension, SDK and middleware, integration recipes, subagent-tax, maintainer tooling) name why they have no Pi surface. Upstream's runtime suite pins pi-ai 1.0.2; `test-runtime.mjs` admits the installed 1.0.4 only through the file-level review in `scripts/sdk-review.json`.

`rpc-smoke.mjs` drives a real Pi over RPC with the default model. It checks skill discovery, prompt injection, `/caveman status`, `/ultracave`, `/megacave`, one-shot restore, `/caveman-stats`, `caveman_compress`, `cavecrew`, the mode across manual compaction, an explicit off across a restart with `--continue`, and the mode stored on a forked branch.

## License

Apache-2.0, as upstream. See `NOTICE`.
