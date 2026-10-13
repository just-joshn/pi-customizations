# Cursor documentation quotes (fetched 2026-10-12)

Brief quotes that ground TASK-017, TASK-019, and MODE-006. Full pages are linked, not copied.

## https://cursor.com/docs/subagents.md
| `readonly`      | boolean | No       | `false`               | If `true`, the subagent runs with restricted write permissions (no file edits, no state-changing shell commands).                    |

The subagent task card shows which model ran. The [usage dashboard](https://cursor.com/dashboard/usage) lists that model on the matching usage row.

- **Subagents consume tokens independently** — Each subagent has its own context window and token usage. Running five subagents in parallel uses roughly five times the tokens of a single agent.

## https://cursor.com/docs/agent/security/run-modes.md (Sandboxing defaults)
| **Network**         | Blocked by default, then opened by your network mode and [`sandbox.json`](https://cursor.com/docs/reference/sandbox.md). |

## https://cursor.com/docs/skills.md (frontmatter fields)
| `icon`                     | No       | Icon shown on the badge when the skill is used as a [Custom Mode](https://cursor.com/docs/agent/prompting.md#custom-modes). Defaults to a lightning icon.                          |
| `color`                    | No       | Badge color when the skill is used as a Custom Mode. One of `default`, `green`, `cyan`, `blue`, `purple`, `magenta`, `orange`, `yellow`, `red`, or `brand`.                        |

Any skill with a valid frontmatter block can back a [Custom Mode](https://cursor.com/docs/agent/prompting.md#custom-modes), which keeps the skill in context for the whole session. An active mode shows a badge in the chat input. Style it with the optional `icon` and `color` frontmatter fields:
