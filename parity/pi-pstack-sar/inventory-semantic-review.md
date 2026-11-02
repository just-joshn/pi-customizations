# Changed-resource semantic audit

## Goal and verdict

The goal is pstack 0.15.36 behavioral parity with the SAR report through Pi-native mechanisms. This audit compares every resource marked `changed; semantic review required` in `evidence/inventory-final.json` with `pstack/<path>` at upstream revision `ae5650febf4320793844c12c4adaa937f417f8da` in `/Users/josh-desktop/src/experiments/plugins`.

All 72 changed resources are accounted for individually below. The four omitted resources are also accounted for. Most changes preserve workflow requirements through Pi paths, model specifications, metadata, tool names, and host adapters. The changed resources do not justify an unconditional full-parity claim. Benny's new sweep and claim instructions introduce the concrete limitations described below. These are distinct from the already disclosed lack of hosted VMs, hosted Slack triggers, hosted Bugbot, and inline video playback.

This is a source-content audit, not a runtime or subscription-correctness verdict. No full suites ran in this audit. The parent's 497 identical resources, executable-bit checks, and no-missing-file result are inputs, not semantic proof. The independently reviewed evidence is the actual unified diff for each of the 72 files.

## Method and interpretation

I loaded `requirements.md`, the current package README, and `docs/native-gaps.md`. I compared the changed files with `git show` against the pinned git objects, not the upstream working tree. I read every diff hunk, including the large README and Benny setup rewrites. Unchanged context outside those hunks remains backed by the inventory's identity comparison rather than a claim of fresh whole-file review.

A reviewer can reproduce the comparisons without checking out or changing upstream files. For each changed inventory entry, compare the output of this command with `extensions/pi-pstack/<path>`.

```sh
git -C /Users/josh-desktop/src/experiments/plugins show ae5650febf4320793844c12c4adaa937f417f8da:pstack/<path>
```

The categories below describe semantic changes, not just spelling differences.

- **Preserved** means the changed text retains the workflow's observable requirement or changes only packaging identity.
- **Adapted** means a Pi mechanism replaces the host mechanism while retaining the named workflow intent. This does not establish runtime correctness of that mechanism.
- **Limited** means the file participates in a real capability reduction or unsupported guarantee, even where other parts of its diff preserve behavior.

## Findings that prevent an unconditional parity claim

### F1. Benny timer sweeps can permanently miss reports

The upstream setup and templates specify a trigger for each new top-level Slack report. The Pi timer templates instead scan only the last `SWEEP_LOOKBACK_MINUTES`, take one report per fire, and rely on later fires for the rest. `templates/configuration.example.yaml` supplies a 180-minute lookback. Neither template retains a discovery cursor or queues reports before they leave that window.

This loses coverage when the owner is unavailable for longer than the lookback, or when the backlog outlasts it. Durable timer wakes do not preserve the Slack messages that were never discovered. The next sweep still reads a window relative to its execution time. Repro's timer also defers all work while a recent unfinished repro claim exists, which can grow this backlog. This is a source-derived failure condition, not a measured throughput claim.

Evidence is `automations/benny/templates/triage-automation-prompt.md` steps 1 through 4, `templates/reproduce-automation-prompt.md` steps 1 through 4, and `templates/configuration.example.yaml` under `trigger`. Setup still promises each new report in `skills/setup-benny/SKILL.md` under “The triage subscription must” and “the repro subscription must.” The README discloses offline parking and expiration, but does not disclose loss of undiscovered reports through the moving lookback.

Webhook mode avoids this particular sweep-window problem if an external relay delivers every event. The relay is explicitly not shipped. That intentional external dependency is not itself a newly undisclosed defect.

### F2. The Benny ledger does not establish the duplicate-run guarantee

`FOR_AGENTS.md` asks for “a claim ledger so no report runs twice.” Setup's thread-safety check 8 states that a repeated fire does no work because the ledger already lists the report. The templates actually retry an old `claimed` entry without a `done` entry, and infer that its run died solely from elapsed time. They do not check that worker's liveness before starting another run.

A worker that posted a Slack verdict or created a tracker issue and then died before appending `done` is eligible to run again. A still-live worker exceeding the claim age is also eligible. Existing operational dedupe and thread checks reduce damage, but they do not make the new “no report runs twice” statement true. The repro webhook block checks only the same report's claim, unlike the timer's app-wide recent-claim check, so distinct webhook reports can also run concurrent app repros without the timer's serialization rule.

These are limitations of the new prompt protocol. They are not findings about the durable subscription registry. The root README already states at-least-once delivery and asks automation prompts to make actions idempotent. That disclosure is sound, but the Benny claim must not be treated as proof that those prompts meet it. Evidence is both prompt templates' stale-claim handling and final `done` append, plus setup check 8.

### F3. Readonly workers exclude Slack tools, not necessarily Slack credentials

The upstream operational files require analysis workers to receive no Slack credentials or write actions. The Pi additions correctly prohibit MCP and network writes through `readonly: true`. They do not establish that the worker cannot receive or read a credential. `src/task/tool.ts` builds the child environment with `{ ...process.env, ...childVariables(...) }`, including for readonly launches. Setup explicitly allows `BENNY_SLACK_BOT_TOKEN` in the owning session's environment. A readonly shell is not an environment-variable filter, and the read tool is not described as a secret-file boundary.

Thus the no-Slack-write adaptation is preserved, while “receive no Slack credentials” is not guaranteed by the proposed readonly mechanism. This is a source-derived isolation limit, not a demonstrated credential leak. It affects the added explanation in `FOR_AGENTS.md`, `skills/triage-issue-reports/SKILL.md`, `skills/reproduce-and-fix-issues/SKILL.md`, and setup's capability guidance. The root README's explicit warning that worktrees are not credential boundaries remains correct.

## Individual dispositions for all 72 changed resources

All paths in this table are relative to `extensions/pi-pstack/`. Each row covers every changed hunk in that resource.

| # | Resource | Disposition and semantic rationale |
| --- | --- | --- |
| 1 | `LICENSE` | Preserved attribution through relocation. The root notice changes Lauren Tan to Josh for port code. I read `licenses/pstack.LICENSE`, which retains Lauren Tan's complete upstream MIT notice. The README explains this split. The root-file change alone would not prove retained attribution. |
| 2 | `README.md` | Adapted. Replaces Cursor and Claude installation, mode UI, and host claims with Pi installation and explicit Task, model, loop, subscription, store, transcript, and visualization contracts. Retains the workflow entry points through linked guide and skills rather than the former long catalog. Discloses local worktrees, process lifetime, subscription delivery, external services, and rendering limits. It is not evidence that all those contracts execute correctly. Benny details remain subject to F1 through F3. |
| 3 | `agents/poteto-agent.md` | Preserved. Replaces Cursor-cache search and highest-manifest-version selection with the installed package path supplied by the host. Still requires the entire poteto-mode skill before work and stops if unavailable. |
| 4 | `automations/benny/FOR_AGENTS.md` | Limited. Retains triage, thread-only replies, repro evidence, bounded draft fixes, approval, safe copying, and dependency checks. Replaces hosted automation setup with timer or webhook subscriptions and file memory. Explicitly discloses offline parking and renewal. The new no-duplicate ledger claim and credential-isolation explanation need F1 through F3's qualifications. |
| 5 | `automations/benny/README.md` | Adapted. Retains dormant-pack setup and test-report safety. Replaces Automations editor instructions with subscriptions, Slack MCP, file memory, and a user-run relay. Explicitly discloses local listener, owner availability, expiry, and reboot setup. Does not itself resolve F1 or F2. |
| 6 | `automations/benny/skills/reproduce-and-fix-issues/SKILL.md` | Limited. Replaces Slack action names with MCP tools and run output with Task notifications. Preserves coordinator-only posting, repro gates, status handling, existing-fix verification, and draft-only output. Correctly warns that writable workers inherit Slack access, but readonly does not prove credential absence under F3. |
| 7 | `automations/benny/skills/reproduce-and-fix-issues/references/control-adapter.md` | Preserved. Moves user-owned feature-map placement outside `.pi/automations/benny/`. The fail-closed control requirements stay intact. |
| 8 | `automations/benny/skills/reproduce-and-fix-issues/references/feature-map.example.md` | Preserved. Changes copied-pack and user-owned feature-map example paths to `.pi`. Keeps refresh protection and the required feature-map structure. |
| 9 | `automations/benny/skills/reproduce-and-fix-issues/references/verify-existing-fix.md` | Adapted. A failed comparison stays in the operations thread or final Task message instead of hosted run output. No verification gate is removed. |
| 10 | `automations/benny/skills/setup-benny/SKILL.md` | Limited. Replaces hosted discovery, draft approval, editor handoff, and committed remote checkout with explicit Pi dependency checks, Slack-tool checks, local paths, subscription approval, and harmless thread tests. Retains fail-closed readiness and explicit permission. Claims about every report and repeated fires exceed the prompt protocol under F1 and F2. Readonly worker checks do not establish F3's credential exclusion. |
| 11 | `automations/benny/skills/triage-issue-reports/SKILL.md` | Limited. Preserves coordinator-only posting, child write bans, issue compensation, and thread-only verdicts. Uses readonly Pi workers and final Task messages. The write boundary is concrete, but credential absence is not established under F3. |
| 12 | `automations/benny/skills/triage-issue-reports/references/routing.example.md` | Preserved. Only user-owned routing-map example paths change to `.pi`. Evidence-based routing remains intact. |
| 13 | `automations/benny/templates/configuration.example.yaml` | Limited. Adds target checkout, trigger, schedules, memory, exact Slack MCP tools, Pi models, and `gh` draft creation while retaining safety configuration. The new finite sweep lookback participates in F1. File memory is a protocol description rather than an executable dedupe mechanism under F2. |
| 14 | `automations/benny/templates/reproduce-automation-prompt.md` | Limited. Preserves trusted-marker waiting, exact symptom reproduction, immutable coordinates, draft-only fixes, and coordinator-only posting. Adds sweep or webhook dispatch, claims, configured Task model, default-branch worktree, and final ledger completion. Moving lookback, time-only stale ownership, and differing timer versus webhook serialization cause F1 and F2. |
| 15 | `automations/benny/templates/triage-automation-prompt.md` | Limited. Preserves direct operational-file loading, thread-only verdicts, immutable coordinates, markers, and child write bans. Adds one-report sweeps, webhook dispatch, configured Task model, and claims. The moving window and time-only claim retry cause F1 and F2. |
| 16 | `docs/guide/01-setup.md` | Adapted. Replaces marketplace and Claude commands with Pi installation, plain model-rule path, `.pi` verification skills, next-request rule refresh, and `/mode`. Keeps budgets, role inheritance, verification offers, and first-task guidance. |
| 17 | `docs/guide/02-poteto-mode.md` | Adapted with disclosed limit. `/mode` replaces Custom Mode. Local worktree workers replace remote VMs and `/in-cloud`. The text explicitly says workers share the machine and need separate ports. It does not promise equivalent remote isolation. |
| 18 | `docs/guide/05-build-and-clean.md` | Preserved. `deslop` is now bundled rather than a separately installed team-kit dependency. The precommit cleanup requirement remains. |
| 19 | `docs/guide/06-verify-and-ship.md` | Preserved. Generated verification skills move to `.pi/skills`. Launch, drive, feature-map structure, and end-to-end proof remain unchanged. |
| 20 | `docs/guide/07-overnight.md` | Adapted with disclosed limits. Pi loop, Project files, listed related transcripts, worktree workers, subscriptions, and supervisor replace hosted features. Explicitly requires a running coordinator and awake machine. File references replace Project drag-and-drop context rather than claiming automatic hosted context ingestion. Benny coverage is qualified by F1 and F2. |
| 21 | `docs/guide/09-make-it-yours.md` | Adapted. `.pi` skill placement and bundled create-skill replace Cursor authoring. Bot UI now targets Pi webhook routines and documents owner restoration and reboot setup. Personal-mode mining, review, and authoring gates remain. |
| 22 | `docs/guide/10-recipes-and-pitfalls.md` | Adapted. Uses OS-player video delivery, local worktree terminology, and Pi model inheritance. Retains the warning against concurrent writes and unverified results. |
| 23 | `docs/guide/README.md` | Preserved. The guide index calls the installation a package instead of a plugin. Its learning sequence remains. |
| 24 | `skills/architect/SKILL.md` | Preserved. Uses the host-supplied model-rule path and Pi effort syntax. Still requires competing designs through arena. |
| 25 | `skills/architect/references/runner-prompt.md` | Adapted with disclosed limit. Adds explicit shared-machine, port, output, cache, and stronger-isolation constraints. Keeps independent candidate packages and grounding. |
| 26 | `skills/arena/SKILL.md` | Adapted. Converts model paths and family recognition to provider-aware Pi IDs and effort syntax. Preserves seats, alias fan-out, rejected-model fallbacks, cross-family judge, rubric, and candidate isolation. Drops Cursor-specific composer-family fallback because it is not a Pi model identity contract. Explicitly qualifies shared-machine isolation. |
| 27 | `skills/automate-me/SKILL.md` | Preserved. Replaces Cursor paths, transcript layouts, and built-in create-skill with Pi equivalents. Retains scoped history mining, preference confirmation, draft authoring, and review. |
| 28 | `skills/create-verification-skill/SKILL.md` | Preserved. Only generated project-skill locations change to `.pi`. Launch, doctor, drive, cleanup, and feature-map proof remain. |
| 29 | `skills/figure-it-out/SKILL.md` | Preserved. Clarifies Pi effort suffix and conditional fast-model availability. No planning, verification, or delegation gate changes. |
| 30 | `skills/how/SKILL.md` | Preserved. Replaces model-rule filename and Cursor model slugs with host path and Pi specs. Keeps readonly explorers, explainer roles, and fallback behavior. |
| 31 | `skills/how/references/explainer-prompt.md` | Preserved. Replaces Read, Grep, and Glob names with `read`, `grep`, and `find`. Retains the right to spot-check findings without restarting exploration. |
| 32 | `skills/ketchup-video/SKILL.md` | Adapted with disclosed limit. Retains video rendering, frame QC, subtitle timing, action items, and failure handling. Replaces embedded playback with OS-player opening, actual frame reads, and a video path because Pi does not play inline video. |
| 33 | `skills/ketchup/SKILL.md` | Preserved tool adaptation, with a residual instruction mismatch. Replaces `/visualize` with the tool name and retains evidence-only visuals. Its instruction to embed videos inline remains literal text that Pi cannot fulfill. The host media instruction and ketchup-video supply the practical adapter, so this is not evidence that inline playback exists. |
| 34 | `skills/maintain-verification-skill/SKILL.md` | Preserved. Changes the usual target location to `.pi/skills/verify-*`. Target selection and maintenance scope remain. |
| 35 | `skills/make-bot-ui/SKILL.md` | Adapted with disclosed limits. Replaces hosted `update_state`, panel clicks, and secret-request cards with `subscribe_webhook`, returned credential paths, and nonprinting shell transfer. Retains server-side keys, localhost forwarding, bearer authentication, harmless probing, and Tailscale UI hosting. Correctly distinguishes acceptance from handling and documents offline parking. |
| 36 | `skills/no-comments/SKILL.md` | Preserved. Clarifies Pi effort and fast-model selection. Comment Sicko invocation and acceptance rules remain. |
| 37 | `skills/poteto-help/SKILL.md` | Adapted. Replaces host installation, model paths, refresh timing, mode, plan, skill discovery, links, bot UI, and worker guidance with the actual Pi contracts. Keeps routing to source documents and explicit-work versus help distinction. Discloses worktree isolation limits rather than preserving a false VM claim. |
| 38 | `skills/poteto-mode/SKILL.md` | Adapted. Moves icon and color under metadata, uses bundled dependencies, Pi model syntax, explicit resume and stop tools, and Pi session terminology. Retains triggers, principles, autonomy boundaries, fresh-worker rule, and playbook ownership. Fast variants are conditional on availability, not promised Cursor routing. |
| 39 | `skills/poteto-mode/playbooks/authoring-a-skill.md` | Preserved. Bundled create-skill replaces Cursor's built-in. Validation and testing remain. |
| 40 | `skills/poteto-mode/playbooks/autonomous-run.md` | Adapted. Names the Pi loop mechanism and effort syntax. Keeps predicates, event watchers, heartbeat fallback, and evidence-driven iterations. |
| 41 | `skills/poteto-mode/playbooks/autopilot-full.md` | Adapted with disclosed isolation limit. Local worktree owners and bundled control/deslop replace VMs and team-kit references. `stop_agent` makes replacement explicit. Preserves owner-only writes, early PRs, fresh-head verification, countersign rules, audit loop, and stop handling. |
| 42 | `skills/poteto-mode/playbooks/babysit.md` | Preserved. Generalizes the prohibition on routing to Cursor's competing babysit skill to any competing skill. The merge frontier and mode rules stay intact. |
| 43 | `skills/poteto-mode/playbooks/bug-fix.md` | Preserved. Changes model syntax and loop attribution. Scientific reproduction, root-cause proof, independent implementation, and same-surface verification remain. |
| 44 | `skills/poteto-mode/playbooks/eval.md` | Preserved. Converts effort syntax and transcript scope to Pi session files. Keeps sanitized candidates, blinded judge, actual tool-chain evidence, and full candidate review. |
| 45 | `skills/poteto-mode/playbooks/feature.md` | Preserved. Converts model and effort syntax. Retains mandatory implementation separation, arena when multiple valid shapes exist, domain shape, scoped changes, and live verification. |
| 46 | `skills/poteto-mode/playbooks/hillclimb.md` | Preserved. Converts model and effort syntax. Keeps frozen measurement, one hypothesis per iteration, independent worktrees, and full reversion of rejected changes. |
| 47 | `skills/poteto-mode/playbooks/multi-phase-plan.md` | Adapted. Fixes installed-package paths for check-plan and skill reads, including a fallback when the program repository does not vendor pstack. Converts effort syntax, control dependencies, stop and steer calls, and VM boot recipes. Keeps all required headings, operator go, live and perf gates, ten lanes, independent verification, and review stop. Explicitly blocks lanes that require unavailable machine isolation. |
| 48 | `skills/poteto-mode/playbooks/opening-a-pr.md` | Preserved. Bundled deslop replaces separate team-kit installation. Commit and prose review gates remain. |
| 49 | `skills/poteto-mode/playbooks/orchestrate.md` | Adapted with disclosed isolation limit. Names Project files, PR subscriptions, Task fork/resume, and stop_agent. Replaces VMs with worktrees and explicit shared-resource assignments. Retains coordinator versus owner responsibilities and the three-level topology. The existing depth-two Task guard permits coordinator, sub-coordinator, and worker, but prevents further nested delegation by the leaf worker. |
| 50 | `skills/poteto-mode/playbooks/perf-issue.md` | Preserved. Converts default model and effort syntax. Keeps trace grounding, architecture, independent implementation, and before/after evidence. |
| 51 | `skills/poteto-mode/playbooks/refactoring.md` | Preserved. Converts default model and effort syntax. Keeps the pinned behavior, small moves, caller migration, and real equivalence checks. |
| 52 | `skills/poteto-mode/playbooks/runtime-forensics.md` | Preserved. Clarifies Pi effort and conditional fast variants. Keeps live signal capture and mechanism proof. |
| 53 | `skills/poteto-mode/playbooks/session-pickup.md` | Adapted. Pi session header and message entries replace Cursor transcript assumptions. Worker IDs replace hosted URLs. Keeps workspace privacy, prior-trail authority, operational reconstruction, and resume-point selection. |
| 54 | `skills/poteto-mode/playbooks/shipping.md` | Adapted with disclosed isolation limit. Independent worktree verifiers and bundled control skills replace cloud verifiers and team-kit. Keeps independent verdicts, parent/head comparison, contiguous landing, and patch-id validity rules. |
| 55 | `skills/poteto-mode/playbooks/trace-forensics.md` | Preserved. Clarifies Pi effort and conditional fast variants. Keeps captured-artifact analysis, queryable reduction, and evidence requirements. |
| 56 | `skills/poteto-mode/playbooks/worktree-cleanup.md` | Adapted. Uses Pi worker paths, `/resume`, Pi state directories, and effort syntax. Preserves pinned/active-chat precedence, transcript verification, irreversible-loss pause, and confirmed pruning. Pi has no identical Cursor pinned-sidebar contract, so the explicit user-supplied active set remains the safety input. |
| 57 | `skills/poteto-mode/scripts/bun.lock` | Preserved. Only the workspace package name changes from `@cursor-skill/poteto-mode-tools` to `@pi-pstack/poteto-mode-tools`. Dependency resolution does not change. |
| 58 | `skills/poteto-mode/scripts/package.json` | Preserved. Only the private package name changes. Scripts and dependencies do not change. |
| 59 | `skills/poteto-mode/scripts/worktree-audit.sh` | Adapted. Replaces Cursor transcript-root calculation with Pi session and subagent directories for both main and candidate worktrees. Honors agent-dir, session-dir environment, settings precedence, tilde expansion, and relative settings paths. The classification and advisory-only deletion workflow remain. Source inspection establishes intended path discovery, not execution on every configured filesystem. |
| 60 | `skills/recall/SKILL.md` | Adapted. Updates Pi transcript naming, header/message format, effort syntax, and host-supplied locations. Retains time scope, workspace privacy, live-state checks, and shared-record investigation. |
| 61 | `skills/reflect/SKILL.md` | Adapted. Uses Pi transcript glob and first user-message lookup instead of assuming the first line is a message. Converts model rules, effort syntax, writable MCP reviewer guidance, authoring locations, and bundled create-skill. Retains three review lenses, synthesis, approval, and no-push boundaries. |
| 62 | `skills/reflect/references/divergent-reviewer.md` | Preserved. Maps skill-use evidence to Pi paths and tool names. Still rejects speculative routings to unused skills. |
| 63 | `skills/reflect/references/judgment-reviewer.md` | Preserved. Maps skill-use evidence to Pi paths and tool names. Still requires actual transcript evidence for routing. |
| 64 | `skills/reflect/references/tooling-reviewer.md` | Preserved. Maps skill-use evidence to Pi paths and tool names. Keeps the used-tool scope restriction. |
| 65 | `skills/setup-pstack/SKILL.md` | Adapted. Uses host-advertised Pi model specs and thinking levels, plain Markdown rule at the host path, next-request refresh, and provider-aware effort notation. Keeps budget mapping, role preservation, panel counts, aliases, validation, confirmation, idempotent full rewrite, and optional verification offers. Account entitlement is not proven merely because a model is listed, so availability remains the documented external limit. |
| 66 | `skills/show-me-your-work/SKILL.md` | Preserved. Maps transcript audit to Pi workspace files and clarifies effort syntax. Keeps row-to-transcript audit and cross-family review. |
| 67 | `skills/statechart/scripts/package.json` | Preserved. Only the private package name changes from `@cursor-skill/statechart` to `@pi-pstack/statechart`. Compiler scripts and dependencies remain. |
| 68 | `skills/statechart/scripts/test/cli.test.ts` | Preserved test portability change. Resolves the temporary link-test directory through `fs.realpathSync` before constructing linked launchers. This avoids platform temp-path aliases without removing the chained-link scenario or changing production compiler behavior. |
| 69 | `skills/swarm/SKILL.md` | Adapted with disclosed isolation limit. Converts the rule path and model syntax. Explicitly replaces remote-machine assumptions with worktrees, ports, output, cache assignments, and an unavailable-isolation result. Partition/race modes, output ownership, and verification roles remain. |
| 70 | `skills/teach/SKILL.md` | Adapted with disclosed rendering limit. Uses codemode image generation when configured, otherwise Mermaid. Keeps progressive diagrams and actual image generation when available. Mermaid is not equivalent to a spatial generated image, so this is a documented fallback rather than proof of identical media capability. |
| 71 | `skills/typescript-best-practices/SKILL.md` | Preserved. Moves `paths` under metadata while retaining hidden invocation. Requirements H7 and F6 explicitly treat path matching as inert metadata, not automatic TypeScript activation. No established upstream activation is removed. |
| 72 | `skills/why/SKILL.md` | Adapted. Converts model-rule path, Pi effort syntax, writable MCP reviewer terminology, and MCP discovery to available tools or `pi mcp list`. Keeps one investigator per available evidence category, unavailable-source reporting, and synthesis. |

## Four host-specific omissions

| Omitted upstream path | Disposition |
| --- | --- |
| `.cursor-plugin/plugin.json` | Intentional. Cursor manifest loading is replaced by the Pi package's `package.json.pi` declarations. Requirements H1 through H3 disclose the metadata and logo differences. No Pi workflow depends on this manifest. |
| `.gitignore` | Intentional distribution omission. It is repository hygiene, not an executable workflow resource. The inventory separately checks that required shipped resources exist. Its omission does not itself remove a workflow. |
| `docs/harness/claude-code.md` | Intentional host-scope omission. This package targets Pi and removes obsolete Claude installation links from the changed README and guide. Requirements section 10 explicitly excludes Cursor and Claude distribution channels from Pi package features. It is not a claim of Claude-host parity. |
| `plugin.json` | Intentional. The alternate host plugin manifest is replaced by Pi package registration. Its agent, skill, and branding declarations are host loading data, not a workflow implementation that Pi should execute directly. |

## Boundaries of the verdict

The reviewed transformations preserve the engineering workflow gates except for the specific limitations above. They do not preserve every Cursor host behavior. The following differences are explicit in the current requirements and README and are not newly discovered regressions.

- Worktree workers do not provide remote VMs, independent machines, credential isolation, or laptop-closed execution.
- Hosted Bugbot is external. Existing GitHub review threads remain usable, but the port does not supply the service.
- Slack push triggering needs an external app or relay. Timer sweeps and a local webhook are the shipped alternatives.
- Inline video playback is unavailable. The port delivers a playable file through the system player plus frames and a path.
- Image generation depends on codemode and a configured image model. Mermaid is a weaker fallback for spatial content.
- Project context uses files and transcript references rather than the hosted Project UI. Models must read the references.
- Pi's readonly and fork behavior intentionally implements the intended contract rather than reproducing Cursor's ignored schema fields.
- Models following the prose, external MCP capabilities, account model access, and production service operation are not established by a content audit.

The Prove It Works principle changed the verification method here. I inspected every changed hunk against the pinned object and checked coverage explicitly instead of treating inventory hashes or parent test summaries as semantic proof. The audit does not upgrade source-derived limitations to measured runtime failures.
