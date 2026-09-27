# Compatibility report

The requested 100% behavior parity is not achieved. The plugin requires Cursor capabilities that the official pi extension API does not provide. This package implements portable contracts and preserves every source file. Identical prompt text is not evidence of identical model behavior.

## Implemented contracts

| Source contract | Pi implementation | Evidence |
| --- | --- | --- |
| Complete plugin distribution | Immutable 158-file snapshot with pinned commit and SHA-256 inventory | `scripts/resources.mjs`, `docs/source-inventory.json` |
| 47 pstack workflows and 23 playbooks | 46 skills with their resources, standalone `/bro` prompt, native prompt aliases, and coded mode/setup commands | `package.json`, `docs/resource-map.json` |
| cursor-team-kit dependency distribution | Complete 29-file snapshot, 18 additional skills, both agents, both rules, and all canvas assets | `upstream-team-kit`, `docs/team-kit-source-inventory.json` |
| Required deslop, control-cli, and control-ui workflows | All 18 kit skills remain available through prompt aliases and native skills, bringing the combined total to 64 skills plus the bro prompt | `test/integration.test.ts`, `scripts/verify-cli.mjs` |
| Team-kit alwaysApply rules | Original rule bodies in parent and writable-child structured prompt sections and readonly-child appended prompts, independent of mode | `src/index.ts`, `src/personas.ts`, `src/workers.ts` |
| Team-kit local agent personas | CI watcher preserves its default model request; strict review persona receives its complete rubric | `src/personas.ts`, `test/personas.test.ts`, `test/workers.test.ts` |
| Sticky Poteto mode | Branch-local session entries and structured prompt section; explicit off command and mode tool | `src/index.ts`, integration tests |
| Two agent personas | Complete upstream persona instructions; Poteto child receives full mode instructions | `src/workers.ts` |
| Local task delegation | SDK child sessions, background completion, output, message, stop, and same-transcript resume | `src/workers.ts` |
| Model setup | Available pi model identities, supported effort, all 17 roles, ordered panels, aliases, budget selection, confirmed atomic rule write | `src/models.ts`, model tests |
| Ordered playbook todos | Persistent replace or merge operation with verbatim content | `TodoWrite`, integration tests |
| Preference and approval questions | TUI and RPC selection, free text, multiple selections, explicit cancellation | `AskQuestion`; live external RPC dialog integration remains unverified |
| Workspace transcript evidence | Current branch and workspace-scoped pi session history | `pstack_context` |
| Helper scripts | Complete original scripts, lockfile, and test suites | `upstream/skills/poteto-mode/scripts` |
| Benny source pack | Preserved and excluded from public skill discovery | Package manifest and resource inventory |

## Unmet contracts

| Source requirement | Why parity is unavailable |
| --- | --- |
| Cursor cloud agent environment and durable hosted lifecycle | SDK children run locally and stop with their owner. Cloud requests fail explicitly. |
| Cursor `/loop` and `/goal` scheduling | This extension does not implement Cursor wake scheduling, persistent goals, or cloud sleeper chains. A required loop or goal is an unmet gate. |
| Exact Cursor model entitlements, aliases, speed tiers, and inference behavior | Pi uses provider/model IDs and separate supported thinking levels. Availability depends on configured providers. No silent family substitution occurs. |
| Cursor built-in `create-skill` and `automate` | These instructions and services are not distributed in pstack. They cannot be reconstructed from this repository alone. |
| Terminal, browser, and GitHub execution dependencies | Team-kit instructions are now bundled, but actual project tools, browser binaries, credentials, and target applications remain environment-dependent. No universal UI or CLI check is implied by installing a skill. |
| Cursor built-in `shell` and `explore` agents | The kit review agent's example calls these unpublished personas. Task rejects them. Callers may supply already-collected evidence to the supported review persona, but the prescribed collector orchestration remains unmet. |
| Team-kit CI watcher's `fast` model selector | The source selector is retained and must resolve through configured pi models, or the caller must explicitly select another available model. Its Cursor speed tier cannot be reproduced from the plugin alone. |
| Cursor in-app browser and chat corpus | Canvas assets are bundled, but pi has no Cursor browser. Local browser tools may open the generated HTML. Preference extraction uses the explicitly identified pi workspace corpus, not unavailable Cursor conversations. |
| Benny reviewed Automations editor handoff | The source explicitly requires Cursor's editor and approval flow. Preserved prompts are not deployed automations. |
| Benny worker credential exclusion | Pi local sessions do not establish the required operating-system credential and Slack-write isolation. Benny delegated execution is not verified or enabled. |
| Grok Bot routines, secret handoff, preview, and webhooks | Cursor routine tools and associated services are not supplied by pi core. |
| Cursor chat UUID links, prior history, stores, and worktree transcript checks | Pi history is exposed separately. Original Cursor-specific scripts and references remain unchanged and cannot prove pi history safety. |
| Arbitrary MCP and business service integrations | Writable workers discover installed pi extensions. Availability, permissions, and external service behavior remain installation-specific. |
| UI parity and stochastic instruction compliance | Pi has different UI and system instructions. Deterministic tests cannot establish every possible model decision or identical rendering. |

The runtime tells the model to retain source gates and identify missing dependencies. That instruction is not a security boundary. Task rejects unsupported cloud execution, unknown personas, and unresolved model requests in code. Other workflow gates remain model instructions. Do not interpret the report as proof that every model will obey every workflow instruction.

## Mechanism migration

All 65 original workflow names remain callable. The 63 text-only aliases now use Pi prompt templates, and the three runtime commands remain extension registrations. There are 66 short commands including `/pstack` status. The original instructions and all 23 playbooks remain available. No tool, persona, model role, or branch-state capability was removed.

Prompt aliases ask the model to read the full skill instead of injecting it from an extension command. Native `/skill:name` still expands it directly. This introduces a model-mediated read for aliases, so deterministic tests prove availability and the real read path, not universal model compliance. `/skill:bro` is intentionally removed; `/bro` preserves its complete prompt. Workflow templates need the extension's host context to locate bundled skills. `/bro` and native skills do not need that alias context.

These invocation changes follow the [current mechanism audit](mechanism-audit.md). They preserve the existing capability coverage without claiming a numeric behavior-parity percentage.

The team-kit increment closes three named skill-distribution dependencies. Its remaining 15 skills are additional available workflows, not 15 measured parity fixes. Prompt-rule delivery and persona construction can be tested deterministically. Successful real GitHub, browser, or model-driven workflow execution requires evidence from the user's configured environment. The kit's `loop-on-ci` skill does not implement the missing `/loop` host scheduler.

## Verification limits

The test suite exercises the actual pi resource loader and SDK with a deterministic provider. It does not contact paid model providers or deploy external automations. Source helper test results and final verification counts are recorded in `verification.md`.

The source's worktree audit includes Cursor transcript paths and macOS utilities. Preserve it as source, but do not use it as proof that pi sessions are inactive. The source `orch` CLI maintains an orchestration store; it does not itself provide the missing cloud scheduler.
