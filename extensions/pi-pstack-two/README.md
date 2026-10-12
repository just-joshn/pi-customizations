# pstack for Pi (pi-pstack-two)

This package ports the Cursor plugin [pstack](https://github.com/cursor/plugins/tree/main/pstack) 0.15.20 to Pi 1.1.0, together with what pstack depends on: the `deslop`, `control-cli`, and `control-ui` skills from cursor-team-kit 1.2.0, and the Cursor host features that pstack's skills call by name. The skills ship as upstream wrote them. A small extension supplies the host features in Pi: `/name` skill commands, Custom Modes, the `Task` subagent tool, `TodoWrite`, `AskQuestion`, the always-applied model rule, `/loop`, and a system-prompt map from Cursor paths to Pi paths.

It is a separate port from `extensions/pi-pstack`. Load one or the other, not both, because both claim `/poteto-mode` and the other skill names.

## Get set up

1. Clone the repository and install the package from the checkout. Pi loads a local package in place, so keep the checkout where it is.

   ```sh
   git clone https://github.com/just-joshn/pi-customizations.git
   cd pi-customizations
   pi install ./extensions/pi-pstack-two
   ```

   The package has no runtime dependencies beyond the modules Pi supplies. To try it for one session without installing, run `pi -e ./extensions/pi-pstack-two`.
   Installing changes nothing until you invoke a skill. 51 pstack skills stay out of the model's automatic skill list, as in Cursor; only `/setup-pstack`, `create-skill`, and the three cursor-team-kit skills can load from your words alone.
2. Run `/setup-pstack`. It lists the models the `Task` tool can use, asks for a reasoning budget, maps a model to each role, and writes the model rule. A new rule applies from the next request.
3. Start real work with `/poteto-mode`, a goal, and a check that can pass or fail.

Remove the package with `pi remove ./extensions/pi-pstack-two`. Its state lives in `~/.pi/agent/pstack-two/` (or `$PI_CODING_AGENT_DIR/pstack-two/`): the model rule, plus one folder per workspace under `workspaces/` with subagent transcripts and agent stores. Delete that directory to remove the state too.

## Use it

| You type | What happens |
|---|---|
| `/poteto-mode <task>` | The skill attaches to that one message, as Enter does in Cursor. Every skill Pi loaded works this way, as in Cursor: pstack's (`/how`, `/why`, `/arena`, `/interrogate`, `/principle-prove-it-works`, `/deslop`) and your own, such as a `/<handle>-mode` skill from `/automate-me`. `/skill:<name>` works too. |
| `/mode poteto-mode [task]` | Keeps the skill in context on every turn, as Option+Enter (Custom Mode) does in Cursor. The footer shows `mode: poteto-mode`. `/mode off` exits and `/mode` reports. Any loaded skill can back a mode, including a personal `-mode` skill from `/automate-me`. |
| `/loop 30m <prompt>` | Runs the prompt now and again 30 minutes after each run settles. Without an interval the agent picks each wake with the `Loop` tool, and the loop ends when it picks none and no background subagent is still running. `/loop stop` or Escape during a run ends it. The prompt can be a skill or template command, such as `/loop 1h /poteto-mode run the audit tick`. When a playbook says to arm `/loop`, the agent starts the loop itself with the `Loop` tool. Intervals go up to 24 days. Print and JSON runs, including subagents, exit when they settle, so they have no `Loop` tool and the system prompt tells the agent to keep working instead. |
| `/setup-pstack` | Configures the per-role models. |
| `/poteto-help <question>` | Answers a question about pstack and hands you a prompt to send. |

`/mode` and `/loop` need an interactive or RPC session. In the interactive `/` menu, skills appear under their own names next to Pi's `/skill:<name>` entries. Aliases work even with `enableSkillCommands` off. If you have a prompt template or extension command with a skill's name, yours keeps the name; Pi's built-in commands are handled before any alias.

## How Cursor maps to Pi

| pstack expects (Cursor) | In this port |
|---|---|
| `/name` attaches a skill to one message | The extension rewrites `/name` to Pi's `/skill:name`, which inlines the skill with its path. This works in interactive, print, JSON, and RPC modes. |
| Custom Mode | `/mode <skill>` adds the skill to the system prompt on every request, led by poteto-mode's `reminder` line. |
| `Task` with `subagent_type`, `model`, `run_in_background`, `resume`, `readonly` | `Task` starts a separate `pi --mode json` process per subagent. Foreground calls return the response and an agent ID. Background calls return at once, and a `<task>` notification arrives after your turn ends. One-shot print and JSON runs wait for pending notifications before exiting. Several calls in one message run in parallel. A subagent's own subagents cannot spawn more, and a resumed agent never runs shallower than it was created or than its caller allows. One agent ID never has two running writers, even across Pi processes. Children inherit the parent's project-trust decision (`--approve` or `--no-approve`), so they load the same project resources. Foreground usage, including the child's own subagents and compactions, counts toward the session totals. |
| `poteto-agent`, `comment-sicko` | Read from `agents/*.md`; the type is the file's `name`, so pstack 0.15.20's `comment-sicko` replaces the earlier `Comment Sicko`. `poteto-agent` is a delegate that runs in the background by default; the chat that receives `/poteto-mode` runs the playbook. Unknown types fail with the list of valid ones. |
| Model slugs such as `claude-opus-5-5-xhigh` | Resolve to the Pi model `claude-opus-5-5` at thinking level `xhigh`. `-fast` is ignored. Pi specs such as `deepseek/deepseek-flash:high` work too. `inherit`, `inherit-parent`, `auto`, or no value run on the parent model. A model Pi does not list, or a thinking level the model does not support (Pi reports them per model), fails with the allowed list, as Cursor's Task rejects an unlisted slug. |
| `readonly: true` | The child gets only `read`, `grep`, `find`, `ls`, and `TodoWrite`, and no MCP. A call can make a fresh or resumed agent readonly but never lifts it. Cursor allows read-only shell commands here; Pi has no read-only shell, so a readonly child cannot run `git log` either. |
| `TodoWrite` | Same parameters (`todos` with `id`, `content`, `status`; `merge`). The list follows the session branch and shows above the editor. |
| `AskQuestion` | Asks through Pi's select dialog in interactive and RPC sessions. In print and JSON runs, including subagents, the tool is withdrawn, as the Cursor CLI has none, and the system prompt says to put questions in the final reply. |
| `~/.cursor/rules/pstack-models.mdc` (always applied) | `~/.pi/agent/pstack-two/pstack-models.mdc`, added to every request's system prompt. `write` and `edit` calls on the Cursor file are blocked, however the path is spelled (`~`, `@`, `file://`, a symlink, a case variant on macOS). |
| `agent-transcripts/` named by the system prompt | The system prompt names this workspace's Pi session directory, the current session file, and this workspace's subagent transcripts. |
| "the current agent's store" (orchestrate) | A per-session folder the system prompt names, passed to `orch --store`. |
| An image-generation tool (teach, ketchup) | Pi's codemode `models.generateImages()`, when codemode is on and an image model is configured. |
| Cursor's built-in `create-skill` | A Pi-native `create-skill` skill, written for this package. |
| `.cursor/skills/`, `~/.cursor/skills/` | `.pi/skills/`, `~/.pi/agent/skills/` |
| Cursor tool names in skill text (`Read`, `Grep`, `Glob`, `Shell`) | The system prompt maps them to Pi's `read`, `grep`, `find`, and `bash`, and describes how tool calls and attached skills look in a Pi transcript. |

Subagent transcripts are Pi sessions in `~/.pi/agent/pstack-two/workspaces/<workspace folder>/subagents/`, named by agent ID, next to a small record that `resume` uses to keep the agent's model, type, and directory. Agent IDs belong to the workspace that started them. Children inherit your installed extensions and MCP servers, and they run in your working directory. Give each subagent that writes its own git worktree, because a child process does not isolate the filesystem. A child exits on its own if its parent Pi process dies.

## Limits

- Pi has no cloud subagents. `environment: "cloud"` and `cloud_base_branch` fail with that explanation and tell the agent to repeat the call locally, with each parallel writer in its own git worktree; `swarm` and `orchestrate` default to cloud workers, so their first spawn takes that retry. Task has no working-directory parameter, so a local worker starts in the parent's directory.
- `make-bot-ui` ships, but Grok Bot routines (`update_state`, `SendToUser`) are a hosted Cursor service with no Pi counterpart. The Benny automation pack ships as inert files under `automations/benny/`; it needs Cursor Automations and Slack.
- Background subagent token usage is recorded in the child's transcript and in the `usage` field of the notification's details, but does not enter the session totals. Foreground usage does, through the Task result. Pi 1.1.0 totals a `usage` session entry, but extensions get a read-only session manager without `appendUsage`, and a background result arrives after its tool call has returned. A `tool_result` handler could attach it to a later, unrelated tool call, which would misattribute it and lose it when no tool call follows, so the port does not.
- `/reload`, `/new`, resume, and fork stop running background subagents, with a warning that names how many. Resume one later with its agent ID.
- A print or JSON run waits for its background subagents before it exits, as Cursor's print mode does, with no timeout of its own.
- Subagents start the same Pi script that runs the parent (`process.argv[1]`), or `pi` from `PATH`. Embedding the package through the SDK in another host is not supported.
- Depth limits apply to `Task`. A writable subagent can still start `pi` through `bash`, and that process is outside the port's depth limit and parent watchdog.
- Subagents run headless in JSON mode, so an extension that asks for permission through a dialog cannot ask there.
- The rule guard covers the `write` and `edit` tools. A shell command can still write `~/.cursor/rules/pstack-models.mdc`; the system prompt tells the model not to.
- Whether a model follows a playbook is the model's call. In the recorded runs, claude-sonnet-5-5 at medium effort skipped the poteto-mode playbook in both Cursor and this port, and deepseek-flash followed it. See `parity/pi-pstack-two/evidence/live-summary.md`.
- A model rule from before this version may name a thinking level a model does not support (for example `deepseek/deepseek-flash:xhigh`). Task now rejects such a value with the allowed list; rerun `/setup-pstack` to rewrite the rule.
- Workspace folders follow Pi's session-folder naming, so two paths that differ only by `/` versus `-` (`/a-b/c` and `/a/b-c`) share a folder, as they share Pi's session folder; resume refuses an agent whose record names the other directory.
- The run lock that keeps one writer per agent ID names the process writing the transcript. Two Pi processes that take over the same stale lock within microseconds of each other could both succeed. A lock file without a readable pid counts as held; the error names the file to delete.
- The Bun tools under `skills/poteto-mode/scripts/` (`watch-pr`, `orch`) need Bun, and install their one dependency on first run. `worktree-audit.sh` needs `rg`, `jq`, and macOS's BSD `stat` and `date`, as upstream does.

## Maintain it

`upstream.lock.json` pins `cursor/plugins@1b6d44f` (pstack 0.15.20) and records every shipped file's source and hash. Two transforms exist: each `SKILL.md` gets its `name` set to its directory, with Cursor-only fields moved under `metadata` as `cursor-*`, and `worktree-audit.sh` reads Pi session files instead of Cursor transcripts, finding them the way Pi does: `PI_CODING_AGENT_SESSION_DIR`, then a `sessionDir` setting, then one folder per working directory (`scripts/patches.json`). `skills/create-skill/` is authored here.

```sh
git clone https://github.com/cursor/plugins.git /tmp/cursor-plugins
bun run check:upstream -- --source /tmp/cursor-plugins   # verify the shipped files against the pin
bun run sync:upstream -- --source /tmp/cursor-plugins    # regenerate after moving the pin in scripts/sync-upstream.mjs
bun run typecheck
bun run test
bun run live:e2e -- --model deepseek/deepseek-flash      # real-model scenarios; needs credentials and gives the model under test your real auth.json (see the script header)
```

The parity record for this port is in `parity/pi-pstack-two/`: specification, design decisions, the ledger, fixtures, evidence, and reviews.

## Licenses

The port's own code is MIT (`LICENSE`). The shipped pstack files keep their MIT notice in `licenses/pstack.LICENSE` (© 2026 Lauren Tan), and the three cursor-team-kit skills keep theirs in `licenses/cursor-team-kit.LICENSE`.
