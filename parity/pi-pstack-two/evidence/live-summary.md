# Real-model scenarios

Runner: `extensions/pi-pstack-two/scripts/live-e2e.mjs`. Runs tagged `v20` used the package synced to pstack 0.15.20 (`1b6d44f`); the others used 0.15.17 (`11713c6`). Each run uses a throwaway workspace, `HOME`, and agent directory with the user's `auth.json` symlinked in. Only the driver's provider loads. Pi 1.1.0, JSON mode, `--no-session`. Cursor baselines: `cursor-agent` 2026.10.01 with pstack 0.15.17 installed, same prompt and workspace (`fixtures/cursor/cursor-live-poteto-*.json`).

## LIVE-001: `/poteto-mode` into a playbook todo list

Prompt: `/poteto-mode How does add in calc.js treat two numeric strings such as "2" and "3"? This is a read-only question; do not change any files.` The investigation playbook has four steps. "Verbatim" ignores Markdown emphasis (`**`, backticks), which both hosts' models dropped when they copied steps into a plain-text list.

| Host | Model | Port state | Read playbook | TodoWrite starts with the 4 steps | File |
|---|---|---|---|---|---|
| Cursor | auto | n/a | yes | yes (emphasis dropped) | `fixtures/cursor/cursor-live-poteto-baseline.json` |
| Cursor | claude-sonnet-5-5-medium | n/a | no, answered directly | no | `fixtures/cursor/cursor-live-poteto-sonnet-baseline.json` |
| Pi port | deepseek-flash | before the TodoWrite guideline | yes | no TodoWrite call | file overwritten by run 2; recorded in the session log only |
| Pi port | deepseek-flash | TodoWrite listed with a guideline | yes | 4/4 | `live-poteto-flash-run2.json` (its stored check used exact matching, so it shows false) |
| Pi port | deepseek-flash | same | yes | no TodoWrite call | `live-poteto-flash-run3.json` |
| Pi port | deepseek-flash | plus attached-skill framing | yes | 4/4 | `live-poteto-flash-run4.json` |
| Pi port | deepseek-flash | same | yes | 3/4 (step 1 shortened) | `live-poteto-flash-run5.json` |
| Pi port | claude-sonnet-5-5 (medium) | guideline and framing | no, answered directly | no | `live-poteto-sonnet-run1..3.json` |
| Pi port, 0.15.20 | deepseek-flash | same | yes | 1/4 (steps paraphrased) | `live-poteto-v20-flash-run1.json` |
| Pi port, 0.15.20 | deepseek-flash | same | yes | 3/4 (step 3 shortened: the decision-only clause dropped) | `live-poteto-v20-flash-run2.json` |

Reading: the port delivers the playbook and the todo tool. Across both versions, deepseek-flash read the playbook in 6 of 6 runs, opened a todo list in 5 of 6, and copied all four steps verbatim in 2 of 6. In the 0.15.20 run 2 it also followed the routed how skill: it spawned a readonly `generalPurpose` Task with an explicit model and checked the answer by running the code. With claude-sonnet-5-5 at medium effort, Cursor and the port both skipped the playbook. Compliance is a property of the model and its effort; no single model was observed following the playbook reliably in both hosts. In run 1, the Task call that the how skill makes asked for `claude-opus-5-5-xhigh`, got the Cursor-format rejection with the allowed list, and retried with `deepseek/deepseek-v4-pro`, as the how skill's fallback rule prescribes.

## LIVE-002: `/no-comments` spawns the comment-sicko subagent

| Run | pstack | Model | Task subagent types | File |
|---|---|---|---|---|
| 1 | 0.15.17 | deepseek-flash | `Comment Sicko` | `live-nocomments-flash-run1.json` |
| 2 | 0.15.17 | deepseek-flash | `Comment Sicko` | `live-nocomments-flash-run2.json` |
| 3 | 0.15.20 | deepseek-flash | `comment-sicko` | `live-nocomments-v20-flash-run1.json` |
| 4 | 0.15.20 | deepseek-flash | `comment-sicko` | `live-nocomments-v20-flash-run2.json` |

In both 0.15.20 runs the model ran the foreground subagent, accepted its two `MUST KILL` flags, removed both comments, and confirmed `util.js` matched `main` again.

## LIVE-003: `/setup-pstack` writes the Pi rule

Prompt asks for the large budget, the skill's mapping, and `inherit-parent` for unavailable models, without questions (print mode has no dialog).

| Run | Model | Rule at `<agentDir>/pstack-two/pstack-models.mdc` | 17 role lines | `alwaysApply` | Wrote `~/.cursor/rules` | File |
|---|---|---|---|---|---|---|
| 1 | deepseek-flash | yes | yes | yes | no | `live-setup-flash-run1.json` |
| 2 | deepseek-flash | yes | yes | yes | no | `live-setup-flash-run2.json` |
| 3 | deepseek-flash, Claude models also available | yes | yes | yes | no | `live-setup-flash-claude-available.json` |
| 4 (0.15.20) | deepseek-flash | yes | yes | yes | no | `live-setup-v20-flash-run1.json` |
| 5 (0.15.20, levels listed) | deepseek-flash | yes | yes | yes | no | `live-setup-v20-flash-run2.json` |
| 6 (0.15.20, levels listed) | deepseek-flash | yes | yes | yes | no | `live-setup-v20-flash-run3.json` |

In runs 1 and 2 only deepseek models were available, so the model wrote `inherit-parent` for every role and said why in a comment line, which matches the skill's validation step. Run 3 added the Claude provider (prompt: keep the skill's mapping, use the closest same-family model for an unavailable default). The model wrote `claude-subscription/claude-opus-5-5:xhigh` for the Claude roles and `inherit-parent` for the Grok roles, and the runner resolved every written value through the port's Task model resolver with no failures. In run 4 the model wrote `deepseek/deepseek-flash:xhigh` and `deepseek/deepseek-v4-pro:xhigh`. That run's check reported every value resolved, but it used the resolver of the time, which accepted any thinking level. Pi supports only `off, low, high, max` for deepseek-flash and `off, high, max` for deepseek-v4-pro, so the round-2 resolver rejects both values, as Cursor's Task rejects an unlisted slug. The catalog now lists each model's levels. Runs 5 and 6 used it and the strict resolver: the model wrote `inherit-parent` for every role, which the prompt prescribes when no same-family model is available, and every value resolved. Run 3's `claude-subscription/claude-opus-5-5:xhigh` is a supported level (claude-opus-5-5 supports `low` to `max`), so it still resolves.
