# Reverse engineering: pstack 0.15.36 and dependencies (for pi-pstack)

Authority is the installed marketplace plugin cache (commit `1ba91fc25c0977741dd0e267849e6234b037ed0a`) and the public `plugins` git checkout, not older research notes.

## Sources

| Artifact | Where | Version |
|---|---|---|
| pstack plugin | Marketplace plugin cache under the public plugins tree | 0.15.36 |
| plugins checkout | Local clone of the public plugins repository @ `4dd1d05` | pstack matches cache; team-kit 1.2.0 |
| Soft dependency | Sibling plugin `team-kit` in that repository | 1.2.0 |
| REA Evidence | Local `.audit/rea-pstack-scripts-evidence.json` (gitignored) | poteto-mode scripts + statechart scripts |

REA `analyze_javascript_application` on poteto-mode scripts (13 JS files, complete syntax coverage within view) and statechart scripts (48 JS files) shows the plugin's executable surface is Bun/Node tooling (watch-pr, check-plan, bootstrap, statechart helpers), not a native host binary. Skill bodies are Markdown playbooks that call host tools by name.

## Dependency graph

```
pstack 0.15.36
├── skills/ (58 skill dirs) + agents/ (poteto-agent, comment-sicko)
├── automations/benny/
├── docs/guide/
└── soft dependency (README): install team-kit for
    deslop, control-cli, control-ui, and the rest of that plugin's skills/agents/rules

team-kit 1.2.0
├── skills/ (18) including deslop, control-*, CI/PR helpers, thermo-nuclear, verify-this, …
├── agents/ (ci-watcher, thermo-nuclear-code-quality-review)
└── rules/ (no-inline-imports, typescript-exhaustive-switch)

IDE host (not a package): Task, TodoWrite, AskQuestion, /loop, always-applied model rules,
session transcripts, optional forge CLI, create-skill builtin, subscription tools.
```

`orch.ts` does **not** ship in pstack 0.15.36. The Orchestrate playbook is a short Task/Project document. Older copies of poteto-mode that describe an orch store are stale relative to this plugin version.

## Host surfaces pstack assumes

| Surface | Role in pstack | Pi-native stand-in in pi-pstack |
|---|---|---|
| Task (+ cloud env, resume, fork) | Subagents | `src/task/*` RPC subagents; `environment: "cloud"` → git worktree |
| TodoWrite | Playbook checklists | `src/todo.ts` |
| AskQuestion | Preference forks | `src/ask.ts` |
| /loop + timer subscriptions | Autonomous wakes | `src/loop.ts`, `subscribe_timer` |
| PR/CI subscriptions | Babysit / Orchestrate | `subscribe_github_pr` |
| Webhook automations | make-bot-ui / Benny | `subscribe_webhook` |
| Always-applied model rule | setup-pstack | `pstack-models.md` injected via `src/rule.ts` |
| create-skill (host builtin) | Authoring | packaged `skills/create-skill` |
| deslop / control-* (team-kit) | Ship gates | Vendored under `skills/` |
| Image generation | Visual artifacts | Pi codemode images or Mermaid fallback (documented) |
| Host session transcripts | recall / automate-me / eval | Pi session dir + `<pstack dir>/workspaces/.../subagents` |

## Content vs adaptation

Against the 0.15.36 cache, pi-pstack already shared skill **names**. About 67 paths differed by hash. Diffs are almost entirely Pi path and host rewrites (model rule path, cloud → worktree wording, team-kit → shipped-with-pi-pstack). Byte identity is not the parity bar. Behavioral and inventory parity is.

Intentionally **not** shipped: Claude Code harness mapping notes from upstream. Pi's equivalent contract is `docs/native-gaps.md` plus this file.

## Parity predicate (this run)

1. Every pstack 0.15.36 skill and agent exists under pi-pstack (Pi-adapted text allowed).
2. Every team-kit 1.2.0 skill, agent, and rule exists as a Pi skill or agent (rules become skills). Former always-apply rules are also injected into the host system-prompt section.
3. Host features named in playbooks exist as Pi extension tools/commands.
4. The package has no runtime dependency on the marketplace `pstack` plugin; RES-011 style checks hold.
5. `bun run test` in `extensions/pi-pstack` is green, including RES-013 inventory asserts against the literal team-kit name set.

## Accepted Pi mappings (not missing inventory)

These are intentional Pi-native equivalents, recorded so a trail review does not treat them as open gaps:

- `environment: "cloud"` → isolated local git worktree on `pstack/<agent id>` (same isolation contract for uncommitted parent state).
- Sticky host mode attachment → `/mode <skill>`.
- Always-apply team-kit rules → host section line plus `/no-inline-imports` and `/typescript-exhaustive-switch` skills.
- Hosted automations editor → `subscribe_timer` / `subscribe_webhook` in a long-lived Pi session.
- Built-in PR composer → `gh` / `origin` as the playbooks already name.
- Image tool → Pi codemode `generateImages` or Mermaid when unset.

## REA coverage notes

Static JS graphs for scripts are partial on semantic families (call-flow / data-flow unknowns). That does not block skill parity. Runtime claims about watch-pr or statechart still need their own tests or a live run when those scripts change.
