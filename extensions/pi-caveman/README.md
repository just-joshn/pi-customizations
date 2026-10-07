# pi-caveman

This Pi package brings [Caveman](https://github.com/JuliusBrussee/caveman) to Pi. The agent answers in a terse caveman voice: answer first, filler gone, every technical fact kept. Code, commands, paths, and error strings stay exact. The package matches the agent-side Caveman plugin at upstream commit `99aafe1` (see `UPSTREAM.json`) and uses only Pi's own mechanisms.

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

## Out of scope

The Caveman proxy, engine, `caveman browse`, MCP server, cloud SDKs, and browser extension are separate native programs. The `caveman-setup`, `caveman-learn`, and other proxy skills ship unchanged and drive the `caveman` CLI when it is installed. For proxy routing inside Pi, use upstream's own `@caveman-ai/pi` package.

## Update from upstream

```bash
git clone https://github.com/JuliusBrussee/caveman /tmp/caveman
bun run sync:upstream /tmp/caveman
```

`scripts/sync-upstream.mjs` copies the skills and cavecrew agents, drops frontmatter fields that Pi does not read, applies `overrides/`, and records the commit in `UPSTREAM.json`.

## Verify

```bash
bun run test
bun run typecheck
node scripts/rpc-smoke.mjs
```

`rpc-smoke.mjs` drives a real Pi over RPC with the default model. It checks skill discovery, prompt injection, `/caveman status`, `/ultracave`, `/megacave`, one-shot restore, `/caveman-stats`, `caveman_compress`, `cavecrew`, the mode across manual compaction, an explicit off across a restart with `--continue`, and the mode stored on a forked branch.

## License

Apache-2.0, as upstream. See `NOTICE`.
