# `@justjoshn/pi-modes`

Four Pi-native execution modes and skill-backed custom modes for [Pi](https://pi.dev) (part of the `no-ceilings` package suite):

| Mode | Purpose | Tool Access & Behavior |
| --- | --- | --- |
| **Agent** | Default full-capability agent execution | Full active tools; tracks plan execution steps (`[DONE:n]`) with a live progress widget |
| **Ask** | Read-only Q&A and code explanation | Keeps only read-only tools (`read`, `grep`, `find`, `ls`, `bash`) plus the mode tools, so `edit`, `write`, `powershell`, and any third-party or MCP writer are dropped and blocked; blocks mutating `bash` commands; injects read-only Q&A guidance |
| **Plan** | Read-only exploration and structured planning | Same allowlist and shell guard as Ask; provides `ask_question` and `create_plan` (a `.plan.md` in Pi's agent `plans/` folder with a session header and YAML `todos` when present, plus `phases`, which imply a project plan even without `is_project`); interactive **Ready to build?** flow |
| **Debug** | Hypothesis-driven runtime debugging | Starts a local NDJSON HTTP ingest server (`127.0.0.1:7242-7942/ingest/<uuid>`) writing to `.pi/debug-<6-char-id>.log`; live Runtime Logs widget; `<reproduction_steps>` interactive Proceed / Mark as fixed / Follow-up flow |

Mode guidance applies to runs started by a user prompt or an extension. It stays through tool rounds, steers, follow-ups, and compaction. A mode switch replaces the affected guidance. Compaction restores the same entry, exit, and one-message skill instructions for that run. The next run uses the current mode's guidance without carrying over those one-time instructions.

### Read-only shell policy

Ask and Plan keep `bash`. The guard checks each command in a chain against an allowlist. It rejects file output redirection, bash and zsh process substitution, ANSI-C and locale quoting (`$'...'` and `$"..."`), parameter expansion (`$NAME` and `${...}`), brace expansion, and unquoted pathname expansion (`*`, `?`, `[`) that can hide options. It allows file-descriptor duplication such as `2>&1` and `>&2`. This command policy is not an operating system sandbox.

- `sed` is limited to its printing side. Addresses and `s`/`y` commands are parsed, including scripts attached to `-e` and `-e` inside an option cluster, and `w`, `W`, `e`, `-i`, `-I`, and `-f` are refused, so `sed -n -e'/pat/p'` reads and `sed -n -e'/pat/w out'` does not.
- `git` allows the read subcommands (`status`, `log`, `show-ref`, `branch` listings, `remote` listings, `stash list`, `apply --check`, and similar), including `-C <dir>` and `--no-pager`. Diff-producing commands require `--no-ext-diff --no-textconv`, so `git diff`, `git show`, `git log -p`, and `git stash show -p` are refused without both flags. `git log` pickaxe searches and combined diff forms (`-c`, `--cc`) require the same two flags. `git blame` requires `--no-textconv`, and `git cat-file` refuses `--textconv` and `--filters`. `git apply` refuses `--apply`, `--index`, `--cached`, `--3way`, and `--build-fake-ancestor`. `--ext-diff` and `--textconv` are refused. `git remote add`, `git branch <name>`, `git branch --delete-merged`, `git stash push`, and `--output` are refused. Tag listing requires `-l`/`--list` or a filtering flag; cosmetic flags such as `--color`, `--column`, and `-i` do not make a positional tag read-only. Branch delete, move, copy, force, and upstream options are refused in long form, abbreviated long form, and short clusters.
- Leading environment assignments are limited to locale and display names such as `LANG`, `LC_*`, `TERM`, `NO_COLOR`, and `COLUMNS`. Variables that can choose or configure an executing program, such as `GIT_*`, `BAT_PAGER`, `NODE_OPTIONS`, and `PAGER`, are refused.
- `bat` refuses `--pager`, `--config-file`, `--generate-config-file`, and the `cache` subcommand, so it cannot launch a pager, load a config, build a cache, or write a config. `file` refuses `-C` and `--compile`.
- `find`, `fd`, `sort`, `uniq`, `tree`, `rg`, and `awk` reject their write or execute forms, such as `-exec`, `-delete`, `-oFILE`, `--compress-program`, a second `uniq` path, `-o`, `--pre`, `--hostname-bin`, `system(`, `getline`, and quoted `>` or `|` inside an awk program. Denied long flags are matched by unambiguous abbreviation, so `sort --out` is refused. `uniq` still allows the values of `-f`, `-s`, and `-w`.
- Everything else must be on the read-only allowlist (`cat`, `head`, `grep`, `rg`, `ls`, `wc`, `jq`, and similar). Unknown commands are refused.

## Custom modes

A custom mode is a Pi skill promoted to a persistent mode. Pi discovers both directory skills (`SKILL.md`) and single-file skills. The mode label comes from frontmatter `title`, then `name`, then the skill's ID.

| Invocation | Behavior |
| --- | --- |
| `/skill:<name> [<args>]` | Pi's one-message skill invocation: the skill body rides along with that one message |
| `/mode <name> [<prompt>]` | Enters the custom mode, then submits the rest of the line as the first prompt when present |
| `/mode off` (or `exit`) | Leaves the custom mode |
| `Ctrl+Alt+M` | Leaves the active custom mode instead of cycling execution modes |
| `/mode` | Picker listing the four execution modes and every custom mode |
| `/mode <Tab>` | Argument completions for the built-in modes, every custom mode, and `off` / `color` / `icon` |

The verbs `off`, `exit`, `none`, `disable`, `color`, and `icon` are reserved, and so are the built-in mode names `agent`, `plan`, `debug`, and `ask`. A skill with one of those names is reachable through the picker rather than `/mode <name>`, so a skill named `plan` can never take over Plan mode. When `/mode` matches a multi-word title such as `Color Palette`, the title wins over command verbs and nothing is submitted as a prompt. `chat`, `search`, and `default` are compatibility aliases that apply only when no skill matches, so a skill named `chat` still wins.

While a custom mode is active:

- The entered turn carries the mode's whole skill block, formatted exactly as Pi expands `/skill:<name>` (`<skill name="…" location="…">` with the skill directory as the reference base).
- Every later turn re-injects a sticky reminder naming the mode and the skill file, so the mode survives long conversations.
- Leaving the mode states the exit once, then stops.
- The status line shows the mode's icon and label in its color with an exit hint, and a second slot shows the execution mode whenever one is constraining tools, so Ask or Plan stays visible under a custom mode.
- A prompt that mentions `/<skill-name>` attaches that skill to that message only. A filesystem path such as `/foo/bar`, `/tmp`, or `/dev` does not count. A skill the active custom mode already carries is not attached a second time.

The mode's skill can be edited by hand or configured with `/mode`:

| Command | Behavior |
| --- | --- |
| `/mode icon [<glyph>]` | Picker, or writes `icon:` into the skill frontmatter. Longer than 8 characters is rejected |
| `/mode color [<name>]` | Picker, or writes `color:` into the skill frontmatter. Flow-style maps, leading comments, and quoted keys are normalized to block form, and a BOM or CRLF is preserved |

```yaml
---
name: reviewer
description: Reviews diffs before they ship
icon: "⚡"
color: magenta
---
Review every diff before it ships. Quote the exact lines you would change.
```

Color names: `green`, `cyan`, `blue`, `purple`, `magenta`, `yellow`, `red`, plus the aliases `default`/`brand` (cyan) and `orange` (yellow). Unknown names are rejected and leave the file untouched. `icon` may also be read from a `metadata:` block.

The session stores the active custom mode and restores it on resume. Turns with no mode-state change, including the first turn after resume, do not add another copy of the skill body.

## Commands & Shortcuts

- `Ctrl+Alt+M` — Cycle modes: `Agent → Plan → Debug → Ask`, or leave the active custom mode
- `Ctrl+Alt+P` — Toggle Plan mode
- `/mode [agent|plan|debug|ask|<skill>] [<prompt>]` — Switch execution mode, enter a custom mode, or open the picker
- `/mode off` — Leave the active custom mode
- `/mode color [<name>]`, `/mode icon [<glyph>]` — Set the active custom mode's appearance
- `/agent [<prompt>]` — Switch to Agent mode (optionally submitting a prompt)
- `/plan [<prompt>]` — Enter Plan mode, submit a planning prompt, or review an existing plan
- `/ask [<prompt>]` — Toggle Ask mode or submit a read-only question
- `/debug [<prompt>]` — Toggle Debug mode or submit a debugging prompt
- `/logs` — Show the current Debug NDJSON log path and recent entries

## CLI Flags

- `--mode=<agent|plan|debug|ask|<skill>>` — start in an execution mode or a custom mode. The equals form matters: Pi reserves `--mode <value>` for its output mode (`text`, `json`, `rpc`)
- `--plan` — start in Plan mode

Pi assigns the next bare argument to a boolean extension flag, so `--plan "prompt"` swallows the prompt. Put prompts after `--`, or use `--mode=plan`.
Plans are written to `plans/` inside Pi's agent directory (`~/.pi/agent/plans` by default, or `$PI_CODING_AGENT_DIR/plans`). Set `PI_MODES_PLANS_DIR` to override it.

## Tools Registered

- `switch_mode` — Agent-initiated mode switch proposal with interactive user approval. Without a UI, a switch from Ask or Plan to Agent or Debug is refused; read-only switches still proceed.
- `ask_question` — Structured single/multi-select clarifying questions with automatic `"Other"` freeform option
- `create_plan` — Persists structured markdown plans to Pi's agent directory `plans/` folder; writes YAML `todos` when present and `phases` when given (phases imply a project plan)

## Tests

- `bun run test` — Vitest unit, integration, and regression suites
- `bun run typecheck`
- `bun run test:e2e` — drives the real `pi` binary in a throwaway profile and workspace; needs a logged-in model and exits 77 when none can answer
- `bun run test:e2e:fake` — drives the real `pi` binary against a local OpenAI-compatible server, so it checks startup flags, mode switches, the read-only loadout, a blocked tool call, and a real custom mode without credentials or model variance
