# pstack source audit for a Pi extension

## Baseline and traced entry points

Source is the checked-out official cursor/plugins repository at `/private/tmp/pstack-cursor-source/pstack`. Plugin manifest declares version 0.15.5, MIT license, skills `./skills/`, and agents `./agents/`. The plugin contains 158 files. There are 47 registered skills (24 workflow skills plus 23 principles), 23 Poteto playbooks, two agents, and three Benny operational skills deliberately excluded from skill discovery. A SHA-256 inventory of every file is `/private/tmp/pstack-source-inventory.json`.

Cursor loads `.cursor-plugin/plugin.json`, discovers the 47 skills and two agents, and routes slash invocation into prompt instructions. `/poteto-mode` reads its full principles index, chooses a playbook, copies playbook steps verbatim into a todo list, invokes other skills at their trigger points, and remains active across turns until opt-out. `poteto-agent` reads the complete mode before work and must resume the existing conversation agent rather than spawn a sibling. Routed workflows retain their own agent types instead of inheriting poteto-agent indiscriminately.

There is no extension runtime or hidden plugin hook in the source manifest. Most behavior is specified as model instructions. Exact copied text therefore establishes content parity, not observable host behavior or proof that a model follows every instruction.

## Custom session history discovery

A failing SDK regression reproduced `pstack_context` omitting the active workspace's history when sessions live in a configured custom directory. The tool now passes the active session manager's directory to SDK discovery instead of silently using the default directory. A shared-root fixture returns only the matching workspace's session. The installed real RPC test fails when that one-line fix is reverted and passes when restored. Eleven context tests and the default 451-check RPC suite pass.

This verifies returned history scope and active-directory selection, not read-level isolation across shared storage. A fresh isolated stream-instrumentation probe now reproduces the stronger failure. SDK discovery returns only the own-workspace ID but reads the synthetic foreign body before its workspace filter. No real private transcript was involved. A throwaway exact-header gate reads only the foreign header and refuses its body, while reading the authorized fixture body. This sketch is not production discovery or scalable/permissive-platform isolation proof. Production header-first ownership filtering remains required; the current SDK-based path must not be cited as foreign-body read isolation. Completeness remains explicitly unknown because SDK discovery may skip unreadable files. Exhaustive multi-root history and model-mediated recall still remain unverified.

## Current bundled-agent requirement audit

Both supplied agent snapshots match byte for byte. An initial ledger groups six Poteto-agent clauses and 21 Comment Sicko clauses. Fresh native persona-loader tests pass, including both Comment Sicko names, complete Poteto agent/mode content, and rejection of unknown names. This is loader/content evidence only.

Conversation-agent reuse, actual background placement, exact first output, full reading/principle navigation, scoped diff fallback, live keep-list proof, truthful flags, and report-only execution remain unverified. No agent is spawned under the explicit no-subagent constraint. Source metadata intent must be distinguished from native host execution semantics; preserving `is_background` in prompt text does not prove background allocation. No source obligation is marked complete merely because its phrase appears in a loaded prompt.

## Current setup-pstack requirement audit

The supplied setup source has an initial ledger of 41 clauses spanning detection, budgets, current-state preservation, role/panel semantics, validation, rule persistence, and the optional verification offer. Compound/default-role obligations and model-mediated branches remain unfinished. Fresh model/resolver tests pass. Two fresh real TUI runs pass eleven journeys each, including a detected fixture provider selection whose literal model and unlimited budget are persisted only after confirmation.

The first new fixture used `.mjs` in automatic extension discovery, which the SDK ignores. Source inspection confirmed `.ts` and `.js` support; correcting the fixture suffix exposes the model without a production change. This evidence does not establish real subscription entitlement. The empty-model source fallback requests pasted slugs, while the exercised native UI offers valid aliases; that fallback equivalence remains unresolved. Optional project-harness inspection/offer is forwarded as model instructions and is not covered by direct setup-handler tests. Actual panel fan-out and cross-family execution remain unverified under the no-subagent constraint.

## Current Origin requirement audit

The native Origin skill matches the supplied Cursor source byte for byte. The initial ledger groups 32 semantic clauses with source lines and hashes. Compound obligations and complete line review remain unfinished. Public installation/version/help, corrupt-archive rejection, native resource/prompt exclusion, and absolute-path invocation have receipts with explicit scopes.

A fresh `auth status` invocation against the isolated real installation exits 1 and reports an unauthenticated state. The retained receipt contains only that classification, exit code, and scope. Raw output, identities, and credentials are not retained. No login, token printing, git-helper setup, hosted repository operation, remote rewrite, or update is performed. Login completion, namespace failures, authorization recovery, real credential storage, Linux/Windows behavior, and hosted execution remain unverified. Instruction presence is not enforcement or model adherence.

## Current cursor-team-kit dependency audit

Fresh byte comparisons match all three supplied `control-cli`, `control-ui`, and `deslop` source files to the native copies. The initial ledger groups 35 CLI entries, 40 UI entries, and nine deslop entries. It distinguishes instructions and guardrails, conditional capability recipes, and illustrative code blocks. These are initial groupings, not a completed exhaustive semantic audit or proof of model adherence.

Fresh installed TUI automation passes five reload checks and now saves the startup screen before its first action. A fresh isolated Chrome/CDP canvas run passes seven rendering/interaction checks with before/after screenshots. A separate local CDP run captures an accessibility tree containing the literal fixture heading and a nonempty sampled CPU profile over synthetic read-only computed-style work. The probe source and resulting artifacts are preserved for reruns. These observations establish the exercised mechanisms, not performance improvement, a startup comparison, or memory-leak diagnosis.

The maintained `scripts/verify-canvas-browser.mjs` now passes nine browser checks with a decoy tab, no-match titles/URL diagnostics, positive app marker, source renderer assertions, fresh screenshots, and real CDP mouse collapse. Selecting by tab order fails the counterfactual. A spaced output path reproduced a URL-selection failure; standard file-URL serialization fixes spaces and reserved characters. A real owned Node child reproduced the signaled-exit cleanup wait problem, which now checks both exit and signal status. That primitive test is not a Chrome crash-injection claim. Keyboard/focus browser paths, network controls, trace/heap collection, and CLI startup/hang/memory profiling remain unverified in this audit unit. Deslop's nine instruction entries remain content-only. Green quality tools do not prove that a model performs the requested diff review or follows its editing guardrails.

## Nonzero goal accounting evidence

The goal source requires completion to preserve usage accounting. A new SDK integration test supplies synthetic nonzero main-session receipts. Session totals are 10 tokens before goal creation, 40 tokens and 0.4 synthetic cost after completion, and the same totals after reopening the persisted session. The completed goal record is also checked against its literal objective and status. Fourteen focused goal/delivery/host tests pass; the allowed real RPC suite still passes 451 assertions with zero findings.

This proves preservation of declared session usage, not real provider billing or per-goal attribution. The authoritative skill does not specify a per-goal accounting schema. Dedicated nonzero installed CLI/RPC accounting is now observed. A maintained real RPC test supplies synthetic receipts through the deterministic provider and waits for actual `agent_settled` events. It reads 10 tokens and 0.1 synthetic cost before the fixture goal cycle, 30 tokens and 0.3 after completion, and the same totals after closing and reopening the saved session. The completed objective/status is checked through RPC entries. The zero-only provider makes the new test fail at its first literal accounting assertion. Eleven focused SDK/RPC/settlement tests pass after adding fixture-only nonzero receipts; the default allowed RPC suite remains 451/0. Hosted accounting and real provider billing remain unverified. The initial failing test exposed the old zero-only fixture limitation, not a production accounting defect.

## Current create-skill requirement audit

The supplied Cursor built-in create-skill source has an initial ledger of 56 semantic clauses. These include requirements, guidance, and optional examples. The native port differs in host names, skill directories, question-tool availability, and package-edit protection. Source and port hashes and line references are retained in the audit ledger. The grouping is not an exhaustive completed source-line audit.

Fresh real RPC checks verify discovery of scaffolded personal and project skills in both Pi-specific and `.agents` locations, trust denial/approval, complete body and argument delivery, support-script execution from the skill directory, and explicit-only metadata. HOME/agent storage and the project working directory are now separate. Both personal skills remain visible in a second project; neither first-project skill leaks there. Trust denial hides both project skills and retains both personal skills. Reverting to conflated HOME/workspace reproduces three trust-scope findings and loses the isolated provider registry before later checks. Restoring separation passes 451 assertions with zero findings. The ambient prompt omits both skills when `disable-model-invocation: true` is present. Removing that field produces exactly two failing ambient-discovery checks. Restoring it yields 430 assertions with zero findings. No Task or AI inference runs.

The harness creates skill files directly. It does not prove model-authored quality, discovery questions, exact user-wording preservation, progressive-disclosure behavior, or automatic writing-policy adherence. Reload-after-edit mechanics are now observed in an existing real RPC session through a fixture command calling native `ctx.reload()`. Before reload, a newly created skill is absent and an edited description remains cached. After reload, the new command, updated description, and invoked body appear. An acknowledgement-only fixture produces exactly three failing checks; restoring native reload passes 435 assertions with zero findings. The separate maintained terminal harness now verifies literal `/reload` in the installed Pi TUI. Two fresh runs pass five checks each, including original/new/edited body delivery, the reload notification, and no model request for reload itself. Main-session provider requests and terminal frames are retained. Model-writing requirements remain unverified.

## Runtime capability matrix

| Contract | Source | Pi port requirement / limit |
|---|---|---|
| Native skill registration | manifest skills, all SKILL.md frontmatter | Preserve descriptions, disable-model-invocation flags, full bodies and relative resources. Expose exact convenient slash aliases in addition to Pi's `/skill:name`. `Make Bot UI` is a display name with spaces; handle carefully when registering legal command names. |
| Sticky Poteto mode | poteto-mode frontmatter/body | Persist explicit opt-in and opt-out through session resume, branch navigation and compaction. Do not apply eagerly to every unrelated session. Read entire leaf skills for cited principles. |
| Custom agents | agents/poteto-agent.md; agents/comment-sicko.md | A Task adapter needs named agent prompts. Comment Sicko's first output must be exactly `Yes... Ha ha ha... Yes!`, remains report-only, and uses its narrow keep-list. |
| Task spawn/resume/background | how, why, arena, swarm, architect, interrogate, reflect | Spawn concurrently, explicit model choice, writable directory isolation, scoped transcript/context, resume identity, independent child reports, failure/dropout accounting, completion notifications. A synchronous CLI call alone misses background semantics. |
| Local/cloud placement | swarm; orchestrate; autopilot-* | Cloud VM isolation, pushed base branch, cloud work survival across local host restart, cloud status/liveness, local-only resources and nested depth 3 are mandatory. Local subprocesses are not cloud parity. Require a real provider bridge or mark blocked. |
| Model policy | setup-pstack | 17 role lines, panel list length preserves duplicate and alias seats, family-aware fallback, budgets and confirmed availability, parent aliases auto/inherit-parent. Cursor slugs encode effort and sometimes speed. Pi provider/model + thinking mapping must not silently substitute a model family. |
| Setup UX | setup-pstack steps 3-7 | Detect entitled models, load state/drop retired roles, ask exact four budgets, show all roles, confirm changes, validate before atomic/idempotent write, persist always-applied config, optional verification skill offer once. Pi UI or RPC dialogs needed; noninteractive mode requires an explicit configuration path. |
| Always-applied rules | ~/.cursor/rules/pstack-models.mdc | Pi does not automatically read Cursor rules. Inject parsed native config using documented extension lifecycle; preserve original source file untouched. |
| Todo list | mode, arena, swarm, architect | Durable model-facing tool/state must preserve exact initial phase/step wording and explicit skip reasons. |
| AskQuestion | setup, automate-me and preference forks | Multi-choice, multi-select and free-form questions. Respect approval gates and unavailable UI; never infer approval from a timeout. |
| /loop and /goal | autonomous-run, orchestrate, autopilot-*, multi-phase-plan, shipping | A persistent wake/continuation mechanism, event watcher wakeups, timed heartbeat fallback, cancel/pause handling, restart durability. Timer existence alone does not prove dynamic monitored-shell semantics. |
| Transcript/store access | recall, reflect, automate-me, eval, session-pickup, orchestrate | Workspace-scoped JSONL discovery, active transcript identity, chat UUID citations, modification order, child transcripts and tool-call evidence, session store paths. Must adapt Cursor layout to Pi session APIs without reading other projects. |
| Host built-ins | create-skill, automate, babysit replacement | Authoring requires Cursor's built-in create-skill guidance/eval loop, absent from this plugin. Benny requires built-in automate and reviewed editor. Do not fabricate source or claim these were ported from pstack. |
| Connected tools | why/reference sources; reflect; Benny | Runtime discovery and per-source investigation over git/gh, tracker, long docs, chat, observability, error tracking and warehouse. Unavailable sources are reported as gaps, never simulated. |
| External skill plugin | poteto-mode, opening-a-pr and many playbooks | cursor-team-kit deslop, control-ui, control-cli. These are dependencies not included in pstack. A bridge or separately sourced implementation is required for full behavior. |
| Bot routines and secrets | make-bot-ui | Cursor update_state routine creation, confirm cards, SendToUser secret-request connector handoff, webhook URL, credential files, preview panel and Tailscale. No native generic Pi equivalent proves parity. |
| Benny automations | automations/benny | Entire pack copied to target `.cursor/automations/benny/`, settings enable pstack only, user config outside pack, explicit user request before live automation create/update. Must use Cursor automate reviewed editor handoff. Pi standalone cannot strictly obey while replacing this editor. |
| Git/review/shipping | playbooks and watch-pr | Keep exact GitHub/Origin distinctions, Bugbot skepticism, patch-id verdict validity, independent real-surface receipts, contiguous verified merge frontier, immutable SHAs. Orchestrate still requires Graphite metadata although newer autopilot paths prohibit requiring Graphite. Preserve contextual distinction. |
| Permission semantics | mode autonomy; reflect; Benny | Mode allows reversible external writes but irreversible shared force-push/deploy/delete/customer messages pause. Reflect accepted skill edits require explicit approval. Benny creation/update has explicit gates and credential isolation. Pi default process is not a sandbox; no prompt can establish actual credential isolation. |

## Executable artifacts and dependencies

`skills/poteto-mode/scripts/package.json` contains commander 14.0.0 and development bun-types/typescript, with frozen bun.lock. `bootstrap.ts` hashes package and lockfile, installs with `bun install --frozen-lockfile`, and re-executes. Preserve script permissions and relative imports.

- `scripts/orch/orch.ts` is the Bun/Commander CLI over `orch/store.ts`. It manages unit rows, verification ledger, inbox, gates, frontier, standing orders and derived status. It never spawns/waits/wakes agents. File locking, atomic writes, stale process lock recovery, SHA keyed verdicts and metadata-derived frontier belong to its contract. Graphite (`gt`) is used for stack frontier discovery. It also contains Origin stack parsing.
- `scripts/watch-pr/watch-pr` is the executable wrapper. cli.ts parses GitHub polling modes and status-only; github.ts reads `gh` data/GraphQL, status checks/review threads; policy.ts owns merge decisions, queued polling and backoff; render.ts emits JSON or pretty output; types.ts is the shared result model. Keep terminal exit codes and machine-readable schema. This watcher is explicitly GitHub-only.
- `scripts/check-plan.mjs` checks multi-phase plans including section order, ten live lanes, screenshot artifacts, perf metric/probe/baseline/rule, program goal and audit markers, exact verification rule, and prose punctuation. Requires Node. Do not weaken it to make a port pass.
- `scripts/worktree-audit.sh` is a read-only report requiring bash, git, gh, jq, rg, POSIX tools, and macOS stat/date options. It probes the Cursor transcript path for recent-chat safety. Needs a Pi-aware companion implementation to give equivalent evidence on Pi sessions; preserve original as source.
- `skills/show-me-your-work/scripts/log.sh` appends TSV rows, creates a header only for empty files, strips tabs/newlines/CR and escapes spreadsheet formulas. Preserve these safety details.
- Existing tests under orch and watch-pr plus watch-pr compile fixtures are part of the distribution. Keep them byte-for-byte alongside implementation and lockfile.

Optional or context-specific system dependencies include git, GitHub CLI/auth, Origin, Graphite, Bun, Node, bash, jq, ripgrep, browser/desktop automation, iOS simulators, screen/video capture, Tailscale, Slack, a tracker adapter, cloud credentials and connected data providers. These cannot be assumed installed.

## Benny hard contracts

The pack includes setup-benny, triage-issue-reports and reproduce-and-fix-issues plus prompt templates, configuration template, routing/feature maps, control adapter and existing-fix verification reference. They are direct instructions, not discovered slash skills.

Triage freezes channel/root thread coordinates, preflights the parent before every post, only the coordinator posts, dedupes tracker records, classifies evidence, and emits exactly one trusted marker. Tracker creation requires compensation capability if the Slack verdict fails. Never root-post or retry at root. Follow-up windows are bounded.

Repro accepts markers only from configured triage identity under the same source parent, honors human fix ownership and existing artifacts, requires all seven real UI adapter capabilities, observes the discriminating symptom twice without injected state, captures and independently reviews media, waits a rejection window, and attempts only bounded root-cause fixes. Existing fixes switch to baseline/patch verification. Workers must have Slack credentials and every write capability provably excluded before delegated edits. Before/after proof precedes draft PR, never merge/deploy. Cleanup is mandatory.

## Coverage caveats and acceptance boundary

This audit read the manifest, README, full main workflow and setup skills, agents, core delegation workflows, history/automation flows, major orchestration playbooks, executable entry points and source dependency references. It enumerated and hashed every file. It did not execute source tests or claim line-by-line semantic review of all ~158 files. The implementation should vendor all 158 files and use an automated manifest comparison so omitted leaf docs, images, test fixtures and lockfiles are visible.

Full behavior parity cannot honestly be promised for a Pi-only package without the Cursor cloud/automation/routine dependencies, external skills, exact model availability and equivalent permission isolation. Distinguish byte-identical upstream content, tested native adapters, and externally blocked host-specific workflows. A declared blocker is honest compatibility reporting, not fulfillment of 100% runtime parity. Document this prominently rather than burying it in implementation notes.

## Registered skill inventory

| Skill directory | Description / contract |
|---|---|
| `architect` | Sketch types, signatures, and module structure before code, then stay in the loop while implementation fills in. Use for /architect, 'architect this', 'design this', or non-trivial work where jumping to code would lock in the wrong shape. |
| `arena` | Spawn N parallel candidates at the same task, pick a base, graft the strongest parts of the losers into it. Use for /arena, 'arena this', 'throw it in the arena', or when one attempt at a non-trivial artifact would lock in the wrong shape. |
| `automate-me` | Use for \"automate me\", \"create/update/refresh my -mode skill\", \"turn/capture my preferences or working style into a skill\", or wanting agents to follow how the user works. Drafts or revises a personal -mode skill via create-skill + unslop, optionally pulling fresh evidence from recent transcripts. |
| `blast-radius` | Find what a change could break somewhere else before it ships, beyond the diff, and prove the one fact it's safe because of by running real code instead of writing it up. Use for 'blast radius of X', 'what could this break', or reviewing a small diff you don't trust. |
| `bro` | Restate the last message in plain human language, with no jargon. |
| `create-verification-skill` | Generate a project-local verification skill that drives your app the way a user does — any language, framework, or platform. Use for /create-verification-skill, \"make a control skill for this repo\", or when a project has no scripted way to prove UI/CLI/service behavior. |
| `figure-it-out` | Design an auditable playbook when no narrower one fits: a large migration, an ambitious multi-part change, or work a human reviews after stepping away. Scales rigor to the task, runs a hypothesis loop, and logs decisions via show-me-your-work. Use for /figure-it-out, 'figure it out', a large migration, or when no narrower playbook applies. |
| `how` | Use for \"how does X work\", code walkthroughs before changing something, and placement / ownership / layering questions (\"where should this live\", \"which package owns this\", \"is this the right layer\"). Explains subsystem architecture, runtime flow, onboarding mental models. Use why for motivation. |
| `interrogate` | Use for \"interrogate\", \"adversarial review\", \"multi-model review\", \"challenge this\", \"stress test this code\", \"find blind spots\", or \"tear this apart\". Multiple LLM reviewers challenge changes from independent angles. |
| `maintain-verification-skill` | Periodic pass that keeps a project's verification skill and feature map honest: parallel source readers per feature, one live session driving every feature, at most one PR of proven corrections. Use for /maintain-verification-skill or \"audit the verify skill\". |
| `make-bot-ui` | Build a Grok Bot webhook UI with Cursor routine, secret handoff and Tailscale. |
| `no-comments` | Spawn Comment Sicko, fix accepted findings, and offer encodings for claimed constraints. |
| `poteto-mode` | poteto's agent style for concise, detailed responses, deliberate subagents, unslopped prose, simple code, and verified work. Use for poteto, /poteto-mode, or requests to work in this style. |
| `principle-attack-the-premise` | Apply when two or more fixes that share one premise have failed the same gate. Take a census of which actors hold the imbalance before the next fix, then question the premise instead of writing another fix that assumes it. |
| `principle-boundary-discipline` | Apply when wiring validation, error handling, or framework adapters. Concentrate guards at system boundaries (CLI, config, network, external APIs); trust internal types and keep business logic in pure functions. |
| `principle-build-the-lever` | Apply to any non-trivial work, not just bulk work: edits, migrations, analyses, checks. Build the tool that does it or proves it (codemod, script, generator, or a skill your subagents follow) instead of working by hand. The tool is the artifact a reviewer can rerun. |
| `principle-encode-lessons-in-structure` | Apply when you catch yourself writing the same instruction a second time, or notice a recurring correction. Encode the rule as a lint, metadata flag, runtime check, or script instead of more text. |
| `principle-exhaust-the-design-space` | Apply when facing a novel UI interaction or architectural decision with no precedent in the codebase. Build 2-3 competing prototypes and compare side by side before committing. |
| `principle-experience-first` | Apply when product, UX, or feature-scope tradeoffs come up. Choose user delight over implementation convenience; ship fewer polished features over more rough ones. |
| `principle-fix-root-causes` | Apply when debugging. Trace each symptom to its root cause and fix it there; reproduce first, ask why until you reach it, resist nil-check guards that silence crashes. |
| `principle-foundational-thinking` | Apply before writing logic: choosing core types and data structures, sequencing scaffold-vs-feature work, asking what concurrent actors share. Get the data structures right so downstream code becomes obvious. |
| `principle-guard-the-context-window` | Apply when context is filling up: large outputs, long files, repeated reads, fan-out planning. Route bulk to subagents; keep summaries in the main thread, not raw payloads. |
| `principle-laziness-protocol` | Apply when refactoring, evaluating diff size, or tempted to add abstractions, layers, or signal threading. Bias toward deletion and the smallest change that solves the problem. |
| `principle-make-operations-idempotent` | Apply when designing commands, lifecycle steps, or processing loops that run amid crashes, restarts, and retries. Converge to the same end state regardless of partial prior runs. |
| `principle-migrate-callers-then-delete-legacy-apis` | Apply when introducing a new internal API while old callers still exist. Migrate callers and delete the old API in the same wave instead of preserving compatibility layers. |
| `principle-minimize-reader-load` | Apply when reviewing or shaping code that's hard to trace. Count layers between question and answer, and hidden state in the reader's head; collapse one-caller wrappers and shrink mutable scope. |
| `principle-model-the-domain` | Apply when writing stateful logic, or when code branches a lot or repeats a shape assumption across files. Encode the domain in a structure instead of scattered conditionals. |
| `principle-never-block-on-the-human` | Apply when tempted to ask 'should I do X?' on reversible work. Proceed, present the result, let the human course-correct after the fact; reserve confirmation for irreversible actions. |
| `principle-outcome-oriented-execution` | Apply during planned rewrites and migrations with explicit phase boundaries. Converge on the target architecture; don't preserve smooth intermediate states with throwaway compatibility code. |
| `principle-prove-it-works` | Apply after completing a task, before declaring done. Verify against the real artifact (run the feature, read the actual value, inspect the diff), not a proxy, self-report, or 'it compiles.' |
| `principle-redesign-from-first-principles` | Apply when integrating a new requirement into an existing design. Redesign as if the requirement had been a foundational assumption from day one, instead of bolting it on. |
| `principle-separate-before-serializing-shared-state` | Apply when concurrent actors might write to the same file, branch, key, or state object. Eliminate the sharing first; serialize structurally only when one shared writer is a real invariant. |
| `principle-sequence-verifiable-units` | Apply to multi-step work (sweeps, migrations, runs of similar edits) and to how you stack commits and PRs. Break work into small units that each end in a verifiable state, check each before the next, and order delivery so the sequence proves itself to a reviewer. |
| `principle-subtract-before-you-add` | Apply when sequencing an addition, refactor, or rewrite. Remove dead code, redundant validators, and stub references first, then build on the simpler base. |
| `principle-test-behavior-not-implementation` | Apply when you write, change, or keep a test. Call the code the way its users do and assert the result they observe against a literal expected value. If the test would still pass when every imported function returns undefined, rewrite the assertion or delete the test. |
| `principle-type-system-discipline` | Apply when designing types, reviewing a function signature, or writing code in any statically-typed language. Make illegal states unrepresentable, brand semantic primitives, parse external data at boundaries, refuse to lie to the compiler, exhaust variants, derive from authoritative schemas. |
| `recall` | Reconstruct your recent working context from your own chat history, live state, and the shared record (user reports, prior fixes, incidents), then hand back a tight current-state brief. Use for 'recall my work on X', 'catch me up', 'what have I been working on', 'where did I leave off', before starting or resuming work. |
| `reflect` | Spawn three parallel review subagents over the active transcript, surface learnings, and route each to a concrete edit on an existing skill. Use when the user says reflect. |
| `setup-pstack` | Configure which models pstack uses per role and at what reasoning budget. Detects your available models and writes an always-applied rule that overrides the skill defaults. Use for /setup-pstack, "configure pstack models", "pstack budget", or changing pstack's model choices. |
| `show-me-your-work` | Keep a reviewable decision trail for long-running or unattended work: a TSV log with one row per decision (what, why, evidence, result). Local by default; commit it when a reviewer needs the trail to trust the result. Use for /show-me-your-work, autonomous or multi-phase runs, or work a human reviews after stepping away. |
| `swarm` | Fan out N parallel workers, drain them, and return one report. Use for /swarm, 'swarm this', or parallel coverage, races, gauntlets, and exploration. |
| `tdd` | Use only when the user explicitly asks for TDD, a failing test, or a regression test, OR when the bug has an obvious cheap local test target. Skip when the test path is unclear, expensive, integration-heavy, or not requested. |
| `teach` | Explain a body of work plainly so a person actually understands it. Runs the `how` and `why` skills and weaves what they find into one clear explanation. Use for 'teach me this', 'help me really understand X', 'explain this change or subsystem to me'. |
| `technical-writing` | Layered technical-writing standard: Diátaxis structure, Google developer style sentences, STE instruction rules, Global English syntax. Use for /technical-writing or when writing or reviewing docs, RFCs, readmes, PR descriptions, or commit messages. |
| `typescript-best-practices` | TypeScript best practices. Use when reading or editing any .ts or .tsx file. |
| `unslop` | Cut AI tells from any writing. Must always apply. |
| `why` | Use for 'why does X work this way', 'why we picked Y', design rationale, regressions, postmortems, or data-backed thresholds. Discovers available MCPs and queries each evidence category (source control, issue tracker, long-form docs, real-time chat, infrastructure observability, error tracking, product analytics warehouse) in parallel, then returns a cited read on decisions and tradeoffs. Use how for runtime behavior. |

## Playbook inventory

- `authoring-a-skill.md` (12 lines).
- `autonomous-run.md` (13 lines).
- `autopilot-full.md` (13 lines).
- `autopilot-stack.md` (16 lines).
- `babysit.md` (27 lines).
- `bug-fix.md` (15 lines).
- `eval.md` (25 lines).
- `feature.md` (21 lines).
- `hillclimb.md` (21 lines).
- `investigation.md` (14 lines).
- `multi-phase-plan.md` (156 lines).
- `opening-a-pr.md` (33 lines).
- `orchestrate.md` (111 lines).
- `pause-safely.md` (10 lines).
- `perf-issue.md` (24 lines).
- `prototype.md` (14 lines).
- `refactoring.md` (16 lines).
- `runtime-forensics.md` (11 lines).
- `session-pickup.md` (11 lines).
- `shipping.md` (17 lines).
- `trace-forensics.md` (14 lines).
- `visual-parity.md` (11 lines).
- `worktree-cleanup.md` (14 lines).
