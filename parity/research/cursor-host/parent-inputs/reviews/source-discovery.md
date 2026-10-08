## Overview

The locked checkout matches `ccb5507cec1546dc88135c1139c811e6c59115ba`. I confirmed it with `git rev-parse HEAD`. Its working tree is clean.

The tracked inventory contains **193 files** in `pstack` and `cursor-team-kit`. Four read-only workers report full reads of **183 behavior-bearing text files**, including executable scripts, tests, manifests, rules, references, examples, and documentation. I reconciled their inventories against `git ls-files`. One worker’s headline count was incorrect. Its explicit team-kit inventory contains 27 files, not 28.

This is **source discovery**, not implementation acceptance or runtime verification. No services, scripts, tests, installations, secret access, or file modifications occurred. Recursive closure remains open at host implementations, external services, and runtime-provided inputs.

**Guard the Context Window** shaped the partitioning decision. I read its leaf skill and isolated the bulk source reads into four separate contexts.

## Coverage and exact read inventory

Paths below are relative to `parity/reference/cursor-plugins/`. Brace notation denotes every explicitly named path, not a wildcard.

| Partition | Tracked files | Fully read | Explicit exclusions |
|---|---:|---:|---:|
| `cursor-team-kit/` | 29 | 27 | LICENSE and avatar |
| `pstack/` outside `skills/` | 36 | 28 | LICENSE and seven images |
| `pstack/skills/poteto-mode/` | 45 | 45 | None |
| Other `pstack/skills/` | 83 | 83 | None |
| **Total** | **193** | **183** | **10** |

The 183-file coverage is delegated full-read coverage. It is not a claim that the coordinating context personally read all 183 files. I personally reread official `pstack/skills/setup-pstack/SKILL.md` and `pstack/skills/make-bot-ui/SKILL.md` in full.

### Team-kit, 27 files

```text
cursor-team-kit/.cursor-plugin/plugin.json
cursor-team-kit/README.md
cursor-team-kit/agents/{ci-watcher,thermo-nuclear-code-quality-review}.md
cursor-team-kit/rules/{no-inline-imports,typescript-exhaustive-switch}.mdc
cursor-team-kit/skills/{check-compiler-errors,control-cli,control-ui,deslop,
  fix-ci,fix-merge-conflicts,get-pr-comments,loop-on-ci,
  make-pr-easy-to-review,new-branch-and-pr,pr-review-canvas,
  review-and-ship,run-smoke-tests,thermo-nuclear-code-quality-review,
  verify-this,weekly-review,what-did-i-get-done,workflow-from-chats}/SKILL.md
cursor-team-kit/skills/pr-review-canvas/{renderer.js,styles.css,template.html}
```

### Pstack roots, guides, agents, and Benny, 28 files

```text
pstack/{.cursor-plugin/plugin.json,.gitignore,README.md}
pstack/agents/{comment-sicko,poteto-agent}.md
pstack/docs/guide/{README,01-setup,02-poteto-mode,03-understand,04-design,
  05-build-and-clean,06-verify-and-ship,07-overnight,08-principles,
  09-make-it-yours,10-recipes-and-pitfalls}.md
pstack/automations/benny/{FOR_AGENTS,README}.md
pstack/automations/benny/skills/{setup-benny,triage-issue-reports,
  reproduce-and-fix-issues}/SKILL.md
pstack/automations/benny/skills/reproduce-and-fix-issues/references/
  {control-adapter,feature-map.example,verify-existing-fix}.md
pstack/automations/benny/skills/triage-issue-reports/references/routing.example.md
pstack/automations/benny/templates/configuration.example.yaml
pstack/automations/benny/templates/
  {reproduce-automation-prompt,triage-automation-prompt}.md
```

### Poteto mode, 45 files

```text
pstack/skills/poteto-mode/SKILL.md
pstack/skills/poteto-mode/playbooks/{authoring-a-skill,autonomous-run,
  autopilot-full,autopilot-stack,babysit,bug-fix,eval,feature,hillclimb,
  investigation,multi-phase-plan,opening-a-pr,orchestrate,pause-safely,
  perf-issue,prototype,refactoring,runtime-forensics,session-pickup,
  shipping,trace-forensics,visual-parity,worktree-cleanup}.md
pstack/skills/poteto-mode/references/bugbot-triage.md
pstack/skills/poteto-mode/scripts/
  {bootstrap.ts,bun.lock,check-plan.mjs,package.json,worktree-audit.sh}
pstack/skills/poteto-mode/scripts/orch/{orch.test.ts,orch.ts,store.ts}
pstack/skills/poteto-mode/scripts/watch-pr/{cli.test.ts,cli.ts,
  fakes.test-helper.ts,github.test.ts,github.ts,policy.test.ts,policy.ts,
  render.ts,tsconfig.json,types.compile.ts,types.ts,watch-pr}
```

### Other pstack skills, 83 files

```text
pstack/skills/{architect,arena,automate-me,benchmark-checklist,blast-radius,
  bro,correct,create-verification-skill,figure-it-out,how,interrogate,
  maintain-verification-skill,make-bot-ui,no-comments,poteto-help,recall,
  reflect,setup-pstack,show-me-your-work,swarm,tdd,teach,technical-writing,
  typescript-best-practices,unslop,why}/SKILL.md

pstack/skills/principle-{attack-the-premise,boundary-discipline,
  build-the-lever,encode-lessons-in-structure,exhaust-the-design-space,
  experience-first,explain-the-number,fix-root-causes,foundational-thinking,
  guard-the-context-window,laziness-protocol,make-operations-idempotent,
  migrate-callers-then-delete-legacy-apis,minimize-reader-load,
  model-the-domain,never-block-on-the-human,outcome-oriented-execution,
  prove-it-works,redesign-from-first-principles,
  separate-before-serializing-shared-state,sequence-verifiable-units,
  subtract-before-you-add,test-behavior-not-implementation,
  type-system-discipline}/SKILL.md

pstack/skills/architect/references/
  {design-red-flags,rationale-template,runner-prompt}.md
pstack/skills/create-verification-skill/references/feature-map-example/
  {README,create-note,search}.md
pstack/skills/how/references/{explainer-prompt,explorer-prompt}.md
pstack/skills/interrogate/references/
  {code-quality-review,lead-judgment,reviewer-prompt,rubric}.md
pstack/skills/poteto-help/references/{prompting,recipes}.md
pstack/skills/reflect/references/
  {divergent-reviewer,judgment-reviewer,synthesizer,tooling-reviewer}.md
pstack/skills/show-me-your-work/references/decision-log-template.tsv
pstack/skills/show-me-your-work/scripts/log.sh
pstack/skills/typescript-best-practices/references/patterns.md
pstack/skills/why/references/
  {epistemics,investigator-prompt,source-playbook,synthesizer-prompt}.md
pstack/skills/why/references/sources/{code-archaeology,databricks,datadog,
  incident-postmortem,linear,notion,sentry,slack}.md
```

## Key concepts and recursive dependencies

The source is primarily an **agent instruction system**, supplemented by real CLI implementations. Imperative workflow instructions are supported contracts. Prompt examples, fictional app maps, test fixtures, and placeholder configurations are not shipped product capabilities.

The following graph identifies the principal recursive branches and exact source locators. Named skills resolve to their inventoried `SKILL.md` files.

| Source and exact locator | Dependency branch |
|---|---|
| Both `.cursor-plugin/plugin.json` manifests, `skills` and `agents` fields | Component-directory discovery. Team-kit additionally registers `rules`. Benny’s nested skills are not registered by pstack’s manifest. |
| `pstack/agents/poteto-agent.md`, **Poteto subagent** | Full mode read, then applied principle leaf reads. |
| `pstack/skills/poteto-mode/SKILL.md`, **Non-negotiables**, **Principles**, **Playbooks** | Routed workflows, 24 principle leaves, 23 playbooks, team-kit control/deslop skills, built-in skill creation, loop, and host delegation. |
| `how/SKILL.md`, **Step 2a**, **Step 2b**, **Step 3** | Explorer and explainer templates; Task model roles. Simple and complex branches differ in agent count. |
| `why/SKILL.md`, **Step 3. Spawn Parallel Investigators**, **Step 4. Synthesize** | Source-playbook index, source-specific instructions, investigator/synthesizer prompts, epistemics. Source index recursively reaches all eight source files. |
| `architect/SKILL.md`, **Phase A**, **Phase B**, **Phase C** | How, conditional Why, Arena, runner/rationale/red-flag references, structural principles. Checkpoint is opt-in. |
| `interrogate/SKILL.md`, **Step 3, Spawn Reviewers**, **Step 5, Lead Judgment** | Reviewer prompt, rubric, code-quality lens, lead judgment, configured model panel. Findings are not automatically applied. |
| `reflect/SKILL.md`, **Process** | Three reviewer references, synthesizer reference, transcript evidence, target skills, built-in create-skill, optional tracker/validator. Accepted edits require approval. |
| `create-verification-skill/SKILL.md`, steps **1–5** | Existing harness discovery, generated feature map, three illustrative Notes files, maintenance skill. Maintenance recursively reads feature recipes and drives the real app. |
| `no-comments/SKILL.md`, **Steps** | Comment Sicko agent, conditional How/Why, conditional Architect sketch. Application-code changes are outside its default scope. |
| `show-me-your-work/SKILL.md`, **Logging a row**, **Audit the log against the transcript** | TSV header, `scripts/log.sh`, transcript audit, different-family trail reviewer. |
| `poteto-mode/playbooks/babysit.md`, steps **4, 6, 8–9** | Bugbot triage, watcher, forge checks, loop. Shipping adds independent verdicts and patch-identity rules. |
| `poteto-mode/playbooks/orchestrate.md`, **Store layout**, **Stack safety** | Orch CLI, store implementation, bootstrap, Task/cloud placement, Git, Graphite, forge, loop. |
| `poteto-mode/scripts/orch/orch.ts`, imports, `main` | `bootstrap.ts`, `store.ts`, Commander. Store recursively reaches filesystem state and Git/Graphite subprocesses. |
| `poteto-mode/scripts/watch-pr/watch-pr`, entire six-line entrypoint | Bootstrap, CLI, then GitHub reader, policy, renderer, types. Tests and compile assertions reference those modules. |
| `poteto-mode/scripts/bootstrap.ts`, `ensureDependenciesInstalled` | Package manifest, lockfile, frozen dependency installation, install marker, process restart. |
| `team-kit/skills/verify-this/SKILL.md`, **Local Surfaces** | Control-cli/control-ui, then repo-native harnesses or optional PTY/tmux/browser/CDP tooling. |
| `team-kit/skills/pr-review-canvas/SKILL.md`, **Workflow** | GitHub API, jq, Python, three shipped assets, local HTTP server, in-app browser. Template additionally references Google Fonts. |
| `benny/FOR_AGENTS.md`, **for the agent** | Setup, templates, operational skills, examples, shared pstack skills, project settings, integrations. |
| `benny/skills/setup-benny/SKILL.md`, steps **1, 4–8**, **Creation boundary** | Project-rooted discovery, committed pack/config/maps, adapter capabilities, automate/editor approval lifecycle. |
| Benny operational skills, **1. Freeze source coordinates** | Trigger/configuration, Slack reads/writes, dedupe, trusted verdict identity, tracker/control adapters, evidence and cleanup. |
| `make-bot-ui/SKILL.md`, **Create the webhook routine**, **Request the sender key**, **Handle the webhook wake** | Host routine and secret-request tools, credential delivery, webhook service, local server, Tailscale. |

Internal referenced text targets are covered by the read inventory. This does not close external links or host implementations.

## Falsifiable requirements and lifecycle

These are source requirements suitable for later acceptance design. They are **not acceptance verdicts**.

| Requirement | Source locator |
|---|---|
| Matched playbooks are read; their steps are copied verbatim; skipped steps retain a reason. | Mode **Playbooks**. |
| Delegates are fresh by default. Reuse requires costly agent-held state. Ordinary playbook delegates use poteto-agent; routed workflows retain their own types. | Mode **Subagents**. |
| Reversible actions proceed; shared force pushes, deployments, data deletion, and customer messages pause. Named operator gates remain binding. | Mode **Autonomy**. |
| Investigations return cited answers without code changes or PRs. Forensics routes return diagnoses rather than silently becoming fixes. | Investigation steps **1–4**; runtime/trace-forensics numbered steps. |
| Bug fixes require same-surface reproduction and runtime-confirmed mechanism. Cheap tests follow failing-before cadence; expensive paths have explicit alternatives. | Bug-fix steps **1–5**; `tdd/SKILL.md`, **If a Failing Test Is Impractical**. |
| Features start with a named data shape and throughput checkpoint. Refactoring pins behavior and proves equivalence beyond static checks. | Feature steps **1–4**; refactoring steps **1, 6–7**. |
| Arena isolates candidates, cross-judges after candidates finish, records base/grafts/rejections, and verifies the synthesis. Swarm drains all required lanes and treats gaps as gaps. | Arena phases **A–F**; Swarm phases **A–D**. |
| Benchmark claims identify the limiter and exclude skipped work, errors, unfair tuning, and noise. Normal comparison uses at least five alternating runs per side. | Benchmark-checklist **The questions**, **Report**. |
| Generated verification instructions are executed end to end before handoff. Maintenance edits verification artifacts, not product code, and drives every feature live. | Verification creation steps **1–5**; maintenance **Edit scope**, **Pass**. |
| Opening an ordinary PR produces a ready PR and does not itself start babysitting. Babysit declares mode and does not authorize merging. | Opening-a-pr **Readiness**, **Babysit**; Babysit steps **1, 9**. |
| Shipping requires an independent per-PR verdict and lands only the contiguous verified root run. Stack autopilot never merges; full autopilot owners merge only after root verification. | Shipping steps **1–5**; autopilot-full steps **4–5**; autopilot-stack steps **5–8**. |
| Orch ledger identity is PR plus SHA; missing verdicts produce `NOT-VERIFIED` and exit 2. Atomic replacement and PID locks govern writes. | `orch/store.ts`, `ledger`, `acquireLock`, `atomicWrite`; `orch.ts`, `handleError`. |
| Watch-pr observes GitHub but does not merge. Defaults are single mode, JSON/NDJSON, 60-second polls, 300-second sweeps, no timeout, five consecutive query errors, and drafts disallowed. | `watch-pr/cli.ts`, `parseArgs`; `github.ts`, `GhGitHubReader`. |
| Watcher check discovery falls back to paginated GraphQL. Both paths empty fail closed. Queued mode freezes its PR list and never emits READY. | `github.ts`, `resolveChecks`; `policy.ts`, `runQueued`. |
| Worktree audit advises rather than authorizes deletion. Its implementation can fetch Git state and inspect workspace transcripts. | `scripts/worktree-audit.sh`; worktree-cleanup steps **1–5**. |
| Team-kit CI workflows use PR-attached checks as overall truth and preserve non-Actions failures. | Fix-ci/loop-on-ci **Workflow**; ci-watcher **Workflow**. |
| Review-canvas injects shipped assets, safely transports patch JSON, serves locally, and opens the host browser. Rendering move detection is heuristic, not semantic proof. | Canvas **Workflow**; renderer `detectMoves`, `loadPrDiffs`. |
| Benny automation creation requires an explicit request and sequential built-in automate approval. Updates use the editor, not replacement creation. | Benny setup **7. Prepare the live automations**, **Creation boundary**. |
| Benny freezes source coordinates, prohibits source-channel root posts, and reserves Slack writes for the coordinator. | Operational **Hard safety rules**, **1. Freeze source coordinates**. |
| Triage requires dedupe, resolved fields, and compensation capability before issue creation; exactly one substantive marked verdict is allowed. | Triage steps **6–10**. |
| Reproduction trusts only the configured triage identity. Human ownership stops work; existing fix artifacts select verification rather than competing implementation. | Reproduce steps **2–3**. |
| Reproduction requires the symptom twice and reviewed media. An authored fix requires twice-successful patched proof and a draft PR, never merge/deploy. | Reproduce steps **7–8, 11, 13–15**. |
| Existing-fix verification runs baseline and patched behavior twice and never edits the fix. | `verify-existing-fix.md`, **Measure the baseline**, **Measure the patched build**, **Outcomes**. |
| Bot UI keeps credentials server-side, uses both authentication headers, times out after eight seconds, tries once, probes harmlessly, and parses webhook body as untrusted data. | Make-bot-ui **Host the page on this computer**, **Handle the webhook wake**. |

## Current source defaults and diversity

The locked source defaults differ from the max-budget examples in the injected host instructions.

- **Official default budget is large/xhigh.** Code roles use `grok-4.7-xhigh-fast`; prose, judgment, hardest tasks, and synthesis roles use `claude-opus-5-5-xhigh`. Evidence is `setup-pstack/SKILL.md`, steps **3, 5**.
- Unlimited targets `max`; Grok falls back to its available `xhigh` ceiling. Every real written slug must be detected as available. Evidence is setup steps **1, 3–4**.
- Arena, Architect, and Interrogate default to one Claude and one Grok panel entry. Panel length determines seat count. Cross-judge pool selects one judge, preferably a different family. Evidence is setup steps **3, 5**.
- `auto` and `inherit-parent` omit Task’s model field and still count as panel seats. They can therefore remove effective family diversity. Evidence is setup step **3**.
- Eval explicitly requires different-model candidates and a different-family judge. Trail review also requires another family. Evidence is Eval steps **4–5** and show-me-your-work **Cross-model review of the trail**.
- Team-kit’s ci-watcher alone declares `model: fast`; its reviewer has no concrete model declaration. Evidence is both agent frontmatters.

No model entitlement, provider availability, or current user configuration was accessed.

## Permissions, services, and optional branches

**Host-owned dependencies remain unresolved.** These include plugin installation/discovery, mode metadata, Task and cloud execution, model discovery, todo/question interfaces, built-in create-skill, loop, automate, routine creation, secret-request delivery, browser control, transcripts, and parent-chat citation mechanisms.

**External services are conditional, not uniformly mandatory.**

- GitHub and `gh` support PR/CI workflows and watcher implementation.
- Origin is an optional forge branch in newer PR playbooks.
- Graphite is explicitly required by Orchestrate frontier discovery, despite other playbooks saying not to require `gt`.
- Why uses available Slack, Notion, Linear, Datadog, Sentry, Databricks, and Git evidence categories. Named MCP tools are adaptable examples, not a universal fixed integration list.
- Benny requires configured Slack, tracker compensation, app control, media review, build/revision access, and draft-PR capabilities.
- Bot UI uses Cursor webhook routines and optional Tailscale installation/login.
- Canvas fonts use Google Fonts; Mermaid CDN extension is optional.

Prose permission restrictions must not be mistaken for a machine-enforced sandbox. How and Interrogate specify readonly delegation. Why and Reflect deliberately use agent mode for MCP access while prohibiting writes in their prompts. Arena candidates write isolated outputs; maintenance gives live-driving ownership to its coordinator.

Examples include fictional Notes maps, Benny routing/configuration placeholders, Linear selection, sample budgets/retention, generic harness snippets, TypeScript snippets, warehouse tables, smoke-test commands, and plan skeleton values. Their containing instructions can be normative without making those sample products or values mandatory.

## Gotchas and unresolved dependencies

1. **Tool startup is not necessarily read-only.** Bootstrap can install dependencies, write its marker, and restart. Inventory auditing must not invoke these tools merely to obtain help. Source is `bootstrap.ts`, `ensureDependenciesInstalled`.

2. **Benny trigger naming is ambiguous.** Templates expose `message_ts`; operational fallback uses `trigger.ts`. No normalization contract was found. Sources are both template **Trigger** blocks and operational **1. Freeze source coordinates**.

3. **Benny shim scope differs from the operational branch.** The reproduce template says children return findings only. Operational **12. Root-cause and implement** allows isolated fix-phase code edits. The operational file is designated authoritative, but the delegation branch needs explicit reconciliation.

4. **Ready versus draft is contextual.** Ordinary Opening a PR says ready, never draft. Benny explicitly requires draft. These are distinct workflow contracts, not one global setting.

5. **Relative-path prose needs a defined resolution base.** Some playbooks say `playbooks/...` or `scripts/...`, meaning the skill root rather than the containing playbook directory. Why’s synthesizer similarly refers to its epistemics dependency with a potentially misleading relative prefix.

6. **Local text reads do not establish service closure.** Host behavior, MCP schemas, permissions, generated stores, actual app harnesses, available model slugs, runtime configuration, and linked remote records remain unverified.

## Next unread partition

No inventoried behavior-bearing text file remains unread.

The next closure partition is **external host contracts**, beginning with mode/skill discovery metadata, Task/model entitlement and diversity semantics, loop persistence, automation approval/update lifecycle, routine/secret delivery, browser control, and workspace-scoped transcript discovery. Then audit service adapter schemas and runtime-provided Benny/control/verification inputs without reading secrets or starting services.

The ten deliberately unread tracked files are:

```text
cursor-team-kit/LICENSE
cursor-team-kit/assets/avatar.png
pstack/LICENSE
pstack/assets/logo.png
pstack/docs/guide/images/{design,overnight,recipes,router,understanding,verification}.jpg
```

Therefore, this report establishes the text-source inventory coverage described above. It does **not** claim complete recursive dependency closure or full pstack parity.