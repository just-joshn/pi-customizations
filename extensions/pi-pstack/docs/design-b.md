# Candidate B: native Pi package with SDK workers

## Claim and boundary

A faithful native port of the bundled rules, prompts, scripts, and workflow contracts is feasible. An unconditional claim of 100% observed behavior parity is not supportable: the source depends on Reference model slugs, Task execution semantics, Reference chat history, external team-kit skills, Grok Bot services, connected MCPs, /loop, and the Reference /automate/editor service. Pi does not promise those services. LLM instruction following also cannot be proven identical across different hosts, system prompts, models, and credentials. Deliver a traceable contract implementation and report which external workflows were actually exercised. Do not weaken hard gates to make a demonstration pass.

## Package shape

- `package.json`: explicit `pi.extensions` containing one entry point, and `pi.skills` containing only the main skill tree. Use current official package names: `@earendil-works/pi-coding-agent`, `@earendil-works/pi-ai`, and `typebox` as `peerDependencies: "*"`; never import the obsolete historical npm scope because old examples happen to show it.
- `upstream/`: complete pinned snapshot, provenance SHA, license, and per-file SHA256 manifest. This includes hidden plugin metadata, assets, guide images, all scripts and tests, agents, all references and playbooks, and dormant Benny sources.
- `skills/`: generated native skill tree. Transform only reviewed host bindings (paths, tool names, model identifiers, setup persistence), retaining every other byte where possible. Keep a machine-readable mapping from every upstream file to shipped file and ordered transformations. Include all auxiliary scripts and assets; no partial SKILL.md-only port.
- `agents/`: two bundled persona documents, poteto-agent and Comment Sicko. Agent definitions are resources consumed by the runtime, not Pi skills.
- `automations/benny/`: dormant sources, explicitly excluded from the skills manifest, as required by upstream. Translating Reference installation into Pi cannot accidentally register Benny slash skills.
- `src/extension.ts`: Pi registration glue; `src/models.ts`: exact role resolution; `src/workers.ts`: SDK child lifecycle; `src/session-state.ts`: persisted mode/tasks/todos; `src/resources.ts`: path and dependency resolution. Avoid a generic compatibility framework or a global emulation of Reference.

## Native skill invocation and mode

Pi already advertises skills and exposes `/skill:name`; use its discovery and progressive loading. Add `/name` command aliases for all public pstack skills, forwarding the full resolved instructions plus arguments through the supported sendUserMessage API. Paths must remain absolute or relative to the actual skill directory so file pointers remain useful. Do not inline the whole plugin at every turn.

`/poteto-mode` enters a persisted sticky mode and injects the entire mode instructions on its first invocation; before each subsequent agent run, add the active-mode instructions through `before_agent_start` structured system prompt sections. Allow explicit opt-out. Store mode and task state with `appendEntry`, restore from the active session branch, and recompute on session switch, fork/tree changes, and reload. Do not leak mode from one session to another or lose it at compaction.

The poteto-agent wrapper must read full poteto-mode before work and preserve persona identity on resume. Comment Sicko has the exact initial output and report-only scope specified upstream. Neither can silently become a generic agent. Skill invocation with `/skill:poteto-mode`, a short alias, or a recognized explicit natural-language invocation needs the same mode semantics; use command/input/skill-load handling supported by the pinned Pi API and test all paths.

## SDK workers instead of Reference Task emulation

Expose native `pstack_spawn`, `pstack_resume`, `pstack_status`, `pstack_wait`, and `pstack_abort` tools. Translate upstream Task references to these named operations rather than leave dead Reference tool instructions in generated skills.

Use `createAgentSession({cwd, model, thinkingLevel, sessionManager, resourceLoader, ...})` for each child. Persistent SessionManager instances own child transcripts; a task record owns stable task ID, parent session ID, persona, requested role/model, resolved provider/model/effort, working directory, transcript path, state, result/error, and subscriber lifecycle. Never restore children by assigning `session.agent.state.messages`: official SDK explicitly calls SessionManager authoritative.

Spawn starts `session.prompt()` without awaiting its completion inside the tool, then returns a task ID. Promise ownership and event subscriptions live in the runtime, not the tool's temporary stack. Record terminal completion only after the prompt promise settles or the documented `agent_settled` signal, not low-level `agent_end` (which can precede automatic recovery or queued work). Deliver result via a durable parent custom message plus queued follow-up at a safe boundary. Resume opens the same session and persona; while busy it uses explicit `steer` or `followUp`, because implicit prompt concurrency rejects. Abort waits for `session.abort()`; dispose every finished runtime on shutdown. A restarted host marks interrupted tasks accurately and resumes from stored transcripts instead of claiming they stayed alive.

Children load pstack skills and the appropriate shared connector extensions through a controlled DefaultResourceLoader. Guard against self-registration recursively creating children at startup. Preserve nested delegation where workflows require it. Context is file pointers by default, with scoped transcripts supplied when upstream explicitly calls for them. Each writing arm gets the worktree prescribed by arena/swarm/architect; SDK sessions alone do not isolate files or Git state.

Agent mode and behaviorally read-only review are distinct: retain connector access for investigators and reviewers, but instruct or enforce scoped no-write behavior as upstream requires. Do not globally remove all connector tools to simulate Reference readonly mode. For Benny, deny Slack posting tools and credentials to child agents as a separate explicit capability policy; simply omitting tool names while allowing a credential-bearing shell is insufficient.

## Models and setup

Preserve all 17 upstream role lines, list order and multiplicity, family identity, cross-judge family selection, aliases, and fallback reporting. Reference's defaults remain recorded verbatim for provenance (`claude-opus-5-5-max`, `gpt-5.6-sol-max`, `grok-4.7-xhigh-fast`). They are not valid Pi IDs by assertion.

Resolve Pi provider/model and reasoning level separately using the authenticated available model registry and documented supported reasoning levels. No silent substitution across families. Setup offers the four exact budget labels, shows every role and missing selection, drops retired roles, preserves valid existing overrides, validates every real selection, then writes atomically. `auto` and `inherit-parent` snapshot the parent model and reasoning setting, with every panel alias still producing one child. Unsupported effort levels choose only a documented level at or below requested effort, with visible conversion; a model unavailable in Pi remains an explicit unmet dependency until the user configures the role.

Store Pi-native configuration under `~/.pi/agent/pstack/models.json` (or another clearly documented dedicated Pi path), not a Reference alwaysApply rule. Inject its effective role table into every relevant parent and child session. Setup must use ctx.ui.select/input or native equivalent; headless mode must return the exact pending choices and make no partial config write. Offer the verification skill once as the source requires.

## Missing host functions and dependencies

- TodoWrite: implement a native persistent checklist tool/widget, supporting verbatim initial playbook steps, statuses, ordered updates, and restoration. This is part of required behavior, not decoration.
- `/loop`: implement an explicit opt-in continuation scheduler attached to the persistent task, preserving stop/pause conditions and decision trail. A bare retry loop or automatic follow-up after every answer violates upstream autonomy boundaries.
- Chat recall: translate discovery to Pi session history and keep provenance. Access to earlier Reference history requires an explicit optional source adapter; do not pretend Pi history contains it.
- External tools/MCP: enumerate actually available extensions/tools into evidence categories, record gaps, preserve parallel per-source investigators. Use only supported Pi connector packages or explicit adapters; Pi extension APIs do not supply generic Reference MCP inheritance.
- team-kit: required `deslop`, `control-cli`, and `control-ui` remain declared dependencies. Vendor an independently reviewed compatible port or report unavailable dependency at the exact required gate. Renaming unslop to deslop is not equivalent.
- Grok Bot UI: preserve sender-key handoff, webhook, and Tailscale requirements; this remains a service-dependent workflow. A generic local HTTP endpoint is not a faithful replacement by itself.
- Benny: preserve source pack merge rules, destination-only files, conflict review, external configuration, project installation verification from a fresh agent, commit-before-enable, thread coordinates, trusted triage identity, duplicate compensation, ownership/existing-fix checks, twice-reproduced runtime proof, one bounded fix, draft-only PR, and fail-closed missing dependency behavior. Expose a setup/readiness adapter and dormant prompts. Reference automation creation and editor review are unportable as-is; either provide a real Pi scheduler/Slack/tracker/control host with equivalent approval state transitions, or explicitly leave service creation blocked. Do not represent two copied prompts as working automations.
- Existing shell/Bun orchestration, PR watch, plan check, worktree audit, decision logging: ship unchanged when portable and adapt only real host bindings. Preserve their tests, runtime dependencies, execution modes, and source licenses.

## Proof obligations

1. Inventory all upstream files and all required clauses; map each to unchanged resource, exact translation, runtime implementation, or external dependency. Zero unexplained omissions and zero unresolved dead host references in operational generated assets.
2. Typecheck against the pinned current official Pi SDK and run its real resource loader against the package: all public skills load, dormant Benny skills stay absent, all aliases resolve, scripts and relative links exist.
3. Deterministic worker contract tests with injected session factory: concurrent spawn, same-session resume, queued follow-up, completion timing under automatic retry, abort, errors, host reload/session switch/branch/compaction, persona initialization, and no lost result.
4. Model resolver tests: every role, absent/retired roles, aliases, duplicate aliases, family fallback, panel sizing, budget floor, credentials absence, and unavailable exact defaults. Assertions must inspect real selected SDK model/effort.
5. Real Pi runtime integration using a deterministic provider proves extension loading, tool calls, background work, parent delivery, nested workers, session persistence, and command invocation. Live credentialed multi-provider trials separately demonstrate actual available model families; mocks cannot establish provider parity.
6. Script regression suites plus real worktree/plan/orchestration scenarios demonstrate shipped operational behavior. User journey fixtures cover all 23 playbooks and specialist skill gates; representative live runs support but do not prove stochastic adherence.
7. Benny contract tests exercise immutable channel/thread, trusted marker, no child Slack authority, missing config, tracker compensation, duplicate/owned/existing-fix paths, twice repro, bounded fix, draft PR, readiness, and no enable before explicit approval. A real authorized Slack/tracker/control trial is necessary to claim working integration.

A final report should say which contracts pass and list unavailable external services. Even a fully passing deterministic suite supports contract parity; it does not establish mathematically identical LLM behavior across Reference and Pi.

## Official source evidence inspected

`packages/coding-agent/docs/packages.md`: manifests, skill discovery, installation, current peer dependency names, no duplicate host libraries.
`docs/skills.md`: progressive disclosure, native `/skill:name`, relative paths, duplicate resolution, dormant tree exclusion need.
`docs/extensions.md`: registerTool/registerCommand, appendEntry, before_agent_start structured prompts, tool-call hooks, user/custom messages.
`docs/sdk.md`: createAgentSession, SessionManager authority, persistent sessions, prompt/steer/followUp, subscribe, agent_settled versus agent_end, abort/dispose, DefaultResourceLoader.
Upstream source examined: README, full setup-pstack, both agents, poteto-mode host contracts, specialist dependency references, Benny README and FOR_AGENTS.
