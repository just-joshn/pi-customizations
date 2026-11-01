# Dependency closure: pstack 0.15.36

Measured against tip `/tmp/cursor-plugins-rea` @ `ae5650febf4320793844c12c4adaa937f417f8da` (plugin version **0.15.36**; tip advanced from inventory lock `4dd1d05818d19792e7cd6e818f1667f95f7e1dbe` only for unrelated `lark-base` / third_party; `pstack/` and `cursor-team-kit/` trees unchanged), installed cache `~/.cursor/plugins/cache/cursor-public/pstack/1ba91fc25c0977741dd0e267849e6234b037ed0a` (byte-identical skill set to tip; tip vs cache skill `SKILL.md` equal **58/58**; cache-only file `.cache-complete`), and `extensions/pi-pstack` `@justjoshn/pi-pstack@0.15.36-pi.3`. Refresh evidence: `../rea-deps/refresh-ae5650f.md`.

Disposition vocabulary matches the unit brief.

## Soft-dep skill names from poteto-mode (complete)

Every skill poteto-mode names as an external or built-in soft dependency in `skills/poteto-mode/SKILL.md` Non-negotiables:

| Soft-dep id | Source poteto names | Closure node |
| --- | --- | --- |
| `deslop` | `cursor-team-kit` plugin (`/deslop`) | `teamkit-deslop` |
| `control-cli` | `cursor-team-kit` | `teamkit-control-cli` |
| `control-ui` | `cursor-team-kit` | `teamkit-control-ui` |
| `create-skill` | Cursor built-in for authoring `SKILL.md` | `cursor-builtin-create-skill` |
| `no-comments` | first-party pstack (`/no-comments`) | `pstack-skill-no-comments` |
| `benchmark-checklist` | first-party pstack | `pstack-skill-benchmark-checklist` |

Also named nearby but **not** soft-deps of another plugin: `unslop`, `technical-writing` (first-party). Babysit is a **playbook** (`playbooks/babysit.md`), and poteto explicitly rejects Cursor's built-in babysit skill. Playbooks also cite `gh` / Origin and Bugbot triage (`references/bugbot-triage.md`). Those are external-service or first-party reference nodes below.

No other `cursor-team-kit` skill name appears as a soft-dep line in the poteto-mode tree (measured: zero extra `` `name` `` / `/name` hits beyond the three above).

## First-party trees

### `pstack-plugin` (root)

| Field | Value |
| --- | --- |
| id | `pstack-plugin` |
| type | first-party-plugin |
| locator | tip `pstack/` (`plugin.json` version `0.15.36`); cache same version |
| pi-pstack | implements as `@justjoshn/pi-pstack` package (`pi.extensions` + `pi.skills`), no runtime read of Cursor plugin paths (`test/resources.test.ts` RES-011) |
| disposition | `in-scope-pi-native` |

### Skill directories (58)

Each tip skill dir under `pstack/skills/<name>/` (list measured complete):

`architect`, `arena`, `automate-me`, `benchmark-checklist`, `blast-radius`, `bro`, `correct`, `create-formal-verification-skill`, `create-verification-skill`, `figure-it-out`, `how`, `interrogate`, `in-your-own-words`, `ketchup`, `ketchup-video`, `maintain-formal-verification-skill`, `maintain-verification-skill`, `make-bot-ui`, `no-comments`, `poteto-help`, `poteto-mode`, `principle-attack-the-premise`, `principle-boundary-discipline`, `principle-build-the-lever`, `principle-encode-lessons-in-structure`, `principle-exhaust-the-design-space`, `principle-experience-first`, `principle-explain-the-number`, `principle-fix-root-causes`, `principle-foundational-thinking`, `principle-guard-the-context-window`, `principle-laziness-protocol`, `principle-make-operations-idempotent`, `principle-migrate-callers-then-delete-legacy-apis`, `principle-minimize-reader-load`, `principle-model-the-domain`, `principle-never-block-on-the-human`, `principle-outcome-oriented-execution`, `principle-prove-it-works`, `principle-redesign-from-first-principles`, `principle-separate-before-serializing-shared-state`, `principle-sequence-verifiable-units`, `principle-subtract-before-you-add`, `principle-test-behavior-not-implementation`, `principle-type-system-discipline`, `recall`, `reflect`, `setup-pstack`, `sharpen`, `show-me-your-work`, `statechart`, `swarm`, `tdd`, `teach`, `technical-writing`, `typescript-best-practices`, `unslop`, `why`.

| Field | Value |
| --- | --- |
| id | `pstack-skills` (aggregate); per-skill ids `pstack-skill-<name>` |
| type | first-party-skill |
| locator | tip `pstack/skills/<name>/` |
| pi-pstack | vendors all 58 under `extensions/pi-pstack/skills/` (`in_pi=yes` for every tip skill). `SKILL.md` sha equal tip→pi: **38**; Pi-native text rewrite: **20** |
| disposition | `vendored` (text may be Pi-rewritten per `design.md`) |

Notable subtrees with executables:

| id | type | locator | pi-pstack | disposition |
| --- | --- | --- | --- | --- |
| `pstack-poteto-mode-scripts` | first-party-scripts | `skills/poteto-mode/scripts/` (18 files tip=pi) | vendored; 15/18 sha-equal; `package.json` / `bun.lock` / `worktree-audit.sh` Pi-adapted | `vendored` |
| `pstack-statechart-scripts` | first-party-scripts | `skills/statechart/scripts/` (405 files tip=pi) | vendored; 404/405 sha-equal (`package.json` name scope `@pi-pstack/statechart`) | `vendored` |

### Agents (2 tip)

| id | type | locator | pi-pstack | disposition |
| --- | --- | --- | --- | --- |
| `pstack-agent-poteto-agent` | first-party-agent | `agents/poteto-agent.md` | present; Pi-rewritten | `vendored` |
| `pstack-agent-comment-sicko` | first-party-agent | `agents/comment-sicko.md` | present | `vendored` |

### Automations (Benny, 12 files)

| id | type | locator | pi-pstack | disposition |
| --- | --- | --- | --- | --- |
| `pstack-automation-benny` | first-party-automation | `automations/benny/**` | all 12 paths present; all Pi-rewritten | `vendored` |

### Docs

| id | type | locator | pi-pstack | disposition |
| --- | --- | --- | --- | --- |
| `pstack-docs-guide` | first-party-docs | `docs/guide/**` (17 files) | present; mixed same/Pi-rewrite | `vendored` |
| `pstack-docs-harness-claude-code` | first-party-docs | `docs/harness/claude-code.md` | **not** shipped (design Removed) | `cursor-platform-out-of-scope-with-pi-substitute` (substitute: `docs/native-gaps.md`, `docs/parity-reverse-engineering.md`) |
| `pstack-asset-logo` | first-party-asset | `assets/logo.png` | present; sha equal | `vendored` |

## cursor-team-kit soft deps (and related vendoring)

Tip team-kit **1.2.0** at `/tmp/cursor-plugins-rea/cursor-team-kit`.

### Soft-deps poteto names (must vendor for zero Cursor plugin dependency)

| id | type | locator | pi-pstack | disposition |
| --- | --- | --- | --- | --- |
| `teamkit-deslop` | soft-dep-skill | `cursor-team-kit/skills/deslop/SKILL.md` | `skills/deslop/`; **SKILL.md sha equal** tip team-kit | `vendored` |
| `teamkit-control-cli` | soft-dep-skill | `cursor-team-kit/skills/control-cli/SKILL.md` | `skills/control-cli/`; **sha equal** | `vendored` |
| `teamkit-control-ui` | soft-dep-skill | `cursor-team-kit/skills/control-ui/SKILL.md` | `skills/control-ui/`; **sha equal** | `vendored` |

### Extra team-kit skills pi-pstack also vendors (not poteto soft-dep lines)

Pi `test/resources.test.ts` `TEAM_KIT` list (20 names): the three soft-deps plus `check-compiler-errors`, `fix-ci`, `fix-merge-conflicts`, `get-pr-comments`, `loop-on-ci`, `make-pr-easy-to-review`, `new-branch-and-pr`, `pr-review-canvas`, `review-and-ship`, `run-smoke-tests`, `thermo-nuclear-code-quality-review`, `verify-this`, `weekly-review`, `what-did-i-get-done`, `workflow-from-chats`, `no-inline-imports`, `typescript-exhaustive-switch`.

| id | type | locator | pi-pstack | disposition |
| --- | --- | --- | --- | --- |
| `teamkit-skills-extra` | soft-dep-adjacent | `cursor-team-kit/skills/<name>/` for non-soft-dep names above | vendored under `skills/` | `vendored` |
| `teamkit-rules-as-skills` | soft-dep-adjacent | `cursor-team-kit/rules/{no-inline-imports,typescript-exhaustive-switch}.mdc` (`alwaysApply: true`) | skills + always-applied line in `src/sections.ts` | `vendored` |
| `teamkit-agent-ci-watcher` | soft-dep-adjacent | `cursor-team-kit/agents/ci-watcher.md` | `agents/ci-watcher.md` (Pi-rewritten) | `vendored` |
| `teamkit-agent-thermo` | soft-dep-adjacent | `cursor-team-kit/agents/thermo-nuclear-code-quality-review.md` | `agents/thermo-nuclear-code-quality-review.md` | `vendored` |

### Cursor built-in soft-dep

| id | type | locator | pi-pstack | disposition |
| --- | --- | --- | --- | --- |
| `cursor-builtin-create-skill` | soft-dep-skill | `~/.cursor/skills-cursor/create-skill/SKILL.md` | `skills/create-skill/` Pi rewrite (not sha-equal; shorter, Pi paths) | `vendored` |

## npm packages (skill scripts)

| id | type | locator | pi-pstack | disposition |
| --- | --- | --- | --- | --- |
| `npm-commander` | npm | `skills/poteto-mode/scripts/package.json` dep `commander@14.0.0` (+ `bun.lock` transitive `@types/node`, `typescript` platform packages, `undici-types`, `bun-types`) | same direct dep in pi scripts `package.json`; lockfile shipped with skill scripts | `vendored` |
| `npm-fast-check` | npm | `skills/statechart/scripts/package.json` devDependency `fast-check@4.5.3` | same | `vendored` |
| `npm-pi-pstack-host` | npm | `extensions/pi-pstack/package.json` dep `@anthropic-ai/sandbox-runtime@0.0.79`; peer `@earendil-works/pi-*`, `typebox` | host extension only (not upstream pstack) | `in-scope-pi-native` |

## Host features Cursor provides that skills call by name

See `host-feature-map.md` for the full map. Aggregate nodes:

| id | type | locator (how skills name it) | pi-pstack | disposition |
| --- | --- | --- | --- | --- |
| `host-task` | cursor-host-feature | `Task` tool (`environment: "cloud"`, resume, fork) | `src/task/*` | `in-scope-pi-native` |
| `host-todo` | cursor-host-feature | `TodoWrite` | `src/todo.ts` | `in-scope-pi-native` |
| `host-ask` | cursor-host-feature | `AskQuestion` | `src/ask.ts` | `in-scope-pi-native` |
| `host-shell-fs` | cursor-host-feature | `Shell` / Read / Grep / Glob / edit | Pi `bash` / `read` / `grep` / `find` / `edit` / `write` (vocabulary in design.md) | `cursor-platform-out-of-scope-with-pi-substitute` |
| `host-mode` | cursor-host-feature | Custom Mode / sticky skill | `/mode` `src/mode.ts` | `in-scope-pi-native` |
| `host-plan` | cursor-host-feature | Plan Mode | `/plan` `src/plan.ts` | `in-scope-pi-native` |
| `host-loop` | cursor-host-feature | `/loop` | `src/loop.ts` | `in-scope-pi-native` |
| `host-subscriptions` | cursor-host-feature | PR/CI subscriptions, timers | `subscribe_*` `src/subscriptions/` | `in-scope-pi-native` |
| `host-routines` | cursor-host-feature | Cursor Automations / webhooks / `SendToUser` secret | `subscribe_webhook`, `/routines`, credential file | `cursor-platform-out-of-scope-with-pi-substitute` |
| `host-visualize` | cursor-host-feature | `/visualize` / visualize tool | `src/visualize.ts` | `in-scope-pi-native` |
| `host-image-gen` | cursor-host-feature | image generation tool | Pi codemode `models.generateImages()` or Mermaid | `cursor-platform-out-of-scope-with-pi-substitute` |
| `host-model-rule` | cursor-host-feature | `~/.cursor/rules/pstack-models.mdc` | `~/.pi/agent/pstack/pstack-models.md` via `src/rule.ts` | `in-scope-pi-native` |
| `host-projects` | cursor-host-feature | Project tracker `notes.md` / store | workspace `projects/` via `src/paths.ts` + prompt section | `in-scope-pi-native` |
| `host-transcripts` | cursor-host-feature | `agent-transcripts` | Pi session dirs + pstack workspaces/subagents | `cursor-platform-out-of-scope-with-pi-substitute` |
| `host-cloud-agent` | cursor-host-feature | cloud agent / cloud VM / CU cloud | isolated git worktree `pstack/<agent id>` | `cursor-platform-out-of-scope-with-pi-substitute` |
| `host-agent-status` | cursor-host-feature | cloud agent dashboard status | `agent_status` | `in-scope-pi-native` |
| `host-steer-stop` | cursor-host-feature | message / stop worker | `Task` resume steer + `stop_agent` | `in-scope-pi-native` |
| `host-fork-turns` | cursor-host-feature | `CreateAgent.fork_turns` | `fork` + `fork_turns` on Task | `in-scope-pi-native` |

## External services

| id | type | locator | pi-pstack | disposition |
| --- | --- | --- | --- | --- |
| `ext-gh` | external-service | GitHub CLI `gh` (default forge) | unchanged; skills call `gh` via shell | `external-service` |
| `ext-origin` | external-service | Origin CLI `origin` when available | unchanged | `external-service` |
| `ext-bugbot` | external-service | Bugbot / agentic security review comments on PRs | triage reference + `gh`/`origin` thread APIs; no Cursor host feature | `external-service` |
| `ext-slack` | external-service | Slack (Benny routing examples, `why` source `slack.md`, overnight guide) | MCP/shell as available on Pi; not bundled | `external-service` |
| `ext-tailscale` | external-service | Tailscale (make-bot-ui remote access) | shell/`tailscale` CLI as on Cursor | `external-service` |
| `ext-graphite` | external-service | Graphite `gt` | poteto forbids requiring it | `external-service` (explicit non-requirement) |

## Open nodes

None measured as inventory-unknown for tip 0.15.36 skill/agent/automation/doc trees or poteto soft-dep names. REA bundle `evidence-bundle.json` (~85 MB, 4 records) covers script static graphs with stated limitations; those limitations are analysis coverage, not missing closure nodes (`open` unused).

## Counts (measured)

- Tip pstack files (approx): **573**; cache **574** (+ `.cache-complete`).
- Tip skill dirs: **58**; pi skill dirs: **79** (+ team-kit set + `create-skill`).
- Tip agents: **2**; pi agents: **4** (+ team-kit agents).
- Soft-dep team-kit `SKILL.md` sha tip→pi: **3/3 equal**.
- poteto-mode soft-dep names enumerated above: **6**.
