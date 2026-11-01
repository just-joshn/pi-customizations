# Guide outcome matrix (tip pstack → pi-pstack)

**Goal.** For every page under tip `docs/guide`, when the user does A/B/C they must get equivalent outcomes X/Y/Z on Pi with pi-pstack via Pi-native mechanisms. A Cursor cloud VM may map to an isolated local worktree. That still counts when the user-visible workflow result matches.

**Sources (measured).**

- Tip: `/tmp/cursor-plugins-rea/pstack/docs/guide/*.md` (11 pages, including README)
- Pi docs: `extensions/pi-pstack/docs/guide/*.md`
- Host: `extensions/pi-pstack/src/**`, skills, playbooks, automations
- Prior inventory: `parity/evidence/rea-pstack-0.15.36/dependency-inventory/host-feature-map.md`, `gap-list.md`

**Status legend.**

| Status | Meaning |
| --- | --- |
| EQUIVALENT | Same user-visible outcome. Mechanism may differ. |
| DOC-ONLY-DIFF | Tip vocabulary or path differs. Pi docs or skills already remap. Behavior exists. |
| GAP | Tip-taught outcome is missing or materially weaker on Pi. |

**Rules applied.** Cursor install/mode/cloud/path words that remaps preserve = DOC-ONLY-DIFF or EQUIVALENT. Missing behavior = GAP. Claude Code harness text on tip is out of scope for Pi (see inventory closure). Laptop-closed Cursor cloud continuity maps to local keep-alive + worktrees per the goal statement, not a plugin GAP.

**Throughput checkpoint.** n/a, read-only investigation.

---

## README.md (guide index)

| Workflow (A/B/C) | Expected outcome (X/Y/Z) | Pi mechanism | Status | If GAP: smallest fix |
| --- | --- | --- | --- | --- |
| Read the 10-page learning path in order | Same topics and prompts teach poteto routing → ship → overnight | Pi guide pages present 1:1 (`docs/guide/01`…`10`, README) | EQUIVALENT | |
| Type `/poteto-help` with a routing question | Answer + prompt to send + link. No work started | `skills/poteto-help/SKILL.md` | EQUIVALENT | |
| One-liner `/poteto-mode` with goal + check | Playbook match, todos, skills fire | `skills/poteto-mode/` + `src/todo.ts` | EQUIVALENT | |
| Tip says "Install the plugin" | User can install and see `/` commands | `pi install` path in Pi README/01-setup (tip `/add-plugin`) | DOC-ONLY-DIFF | |

---

## 01-setup.md

| Workflow (A/B/C) | Expected outcome (X/Y/Z) | Pi mechanism | Status | If GAP: smallest fix |
| --- | --- | --- | --- | --- |
| Install pstack | Package loaded. pstack commands in `/` menu | `pi install ./extensions/pi-pstack` or `npm:@justjoshn/pi-pstack` (`01-setup.md`, package README) | DOC-ONLY-DIFF | |
| Tip Claude Code marketplace install | Claude Code adapter + `pstack:` prefix | Not shipped on Pi (inventory excludes `docs/harness/claude-code.md`) | DOC-ONLY-DIFF | Out of scope. Do not port unless a Pi+Claude product goal appears. |
| `/setup-pstack` | Detect models, set budget/roles, write model rule every skill reads | `skills/setup-pstack/` → `~/.pi/agent/pstack/pstack-models.md` via `src/rule.ts` injection | EQUIVALENT | |
| Tip: start a new chat so the rule applies | Next turns use the rule | Pi injects the rule every request. Same chat works (`01-setup.md`) | DOC-ONLY-DIFF | |
| Accept verify / formal-verify offers | Project skills under a skills dir, proved once | `.pi/skills/verify-<app>/`, formal skill writers (`create-verification-skill`, `create-formal-verification-skill`) | EQUIVALENT | |
| Sticky `/poteto-mode` for the chat | Skill stays every turn until exit | `/mode poteto-mode` / `/mode off` (`src/mode.ts`). Tip Option+Enter Custom Mode | DOC-ONLY-DIFF | |
| First small Feature prompt | Todos show Feature steps. Skips keep `skip:` | poteto-mode + `TodoWrite` (`src/todo.ts`) | EQUIVALENT | |
| `auto` / `inherit-parent` roles | Subagent omits model. Inherits parent | `src/task/models.ts` + setup skill | EQUIVALENT | |
| Cost knobs (smaller budget, shorter panels) | Fewer / cheaper subagents | Same setup skill + role lists | EQUIVALENT | |

---

## 02-poteto-mode.md

| Workflow (A/B/C) | Expected outcome (X/Y/Z) | Pi mechanism | Status | If GAP: smallest fix |
| --- | --- | --- | --- | --- |
| Goal + constraints prompt (`repro first`, done check) | Correct playbook. Visible todos | `skills/poteto-mode/SKILL.md` + 23 playbooks | EQUIVALENT | |
| Five-part prompt (goal, done, proof, knowns, constraints) | Agent honors constraints and shows proof | poteto-mode prompt rules | EQUIVALENT | |
| Restate-only / `/in-your-own-words` | Restatement. No code change | `skills/in-your-own-words/` | EQUIVALENT | |
| `/sharpen` then send rewrite | Expert rewrite. Task not started | `skills/sharpen/` | EQUIVALENT | |
| Short follow-ups under sticky mode (`do it`, `continue`) | Playbook continues | `/mode poteto-mode` + poteto-mode | EQUIVALENT | |
| `new task` + investigation pin | Re-match. Investigation. No edit | poteto-mode routing phrases | EQUIVALENT | |
| Tip: `/in-cloud` or cloud subagents for parallel isolation | Isolated branch + deps/app/video without trampling checkout | No `/in-cloud` skill on tip or Pi. Pi: `Task` `environment: "cloud"` → worktree (`src/task/worktree.ts`). Pi guide remaps | DOC-ONLY-DIFF | Optional thin `/in-cloud` skill that only instructs `environment: "cloud"` if tip command fidelity matters. |
| Explicit local worktree off a base | Own branch/worktree. No stomp | Opening-a-PR / worktree prompts + git worktrees | EQUIVALENT | |
| Disk prune / worktree cleanup | Safe deletes only. Pause on dirty trees | `playbooks/worktree-cleanup.md` | EQUIVALENT | |
| Step away with finish condition + decision log | figure-it-out + show-me-your-work trail | `skills/figure-it-out/`, `skills/show-me-your-work/` | EQUIVALENT | |

**Isolation note (not a GAP under the goal).** Tip cloud VM vs Pi local worktree. Same user-visible result for "parallel agent does not clobber my tree." Isolation strength residual stays in `gap-list.md` §5.

---

## 03-understand.md

| Workflow (A/B/C) | Expected outcome (X/Y/Z) | Pi mechanism | Status | If GAP: smallest fix |
| --- | --- | --- | --- | --- |
| Investigation prompt. No code yet | Cited how/why. Tradeoffs table when choosing | `playbooks/investigation.md` + `/how` `/why` | EQUIVALENT | |
| `/how` narrow or wide | Onboarding-level explanation. Fan-out explorers when large | `skills/how/` + `Task` readonly | EQUIVALENT | |
| `/why` | Cited history from git + MCP categories | `skills/why/` (MCP availability is host config) | EQUIVALENT | |
| `/teach` | Diagram-built explanation. Argument you can test | `skills/teach/` | EQUIVALENT | |
| `/recall` on recent work | Brief from own chats + shared record | `skills/recall/` (Pi session paths, not `agent-transcripts/`) | DOC-ONLY-DIFF | |
| Session pickup on a mid-flight branch | Resume point. No redo of finished work | `playbooks/session-pickup.md` (Pi sessions / worker id / branch. Tip also names cloud-agent URL) | DOC-ONLY-DIFF | |

Tip and Pi guide bodies for this page are byte-identical except shared images. Skill text carries the host remap.

---

## 04-design.md

| Workflow (A/B/C) | Expected outcome (X/Y/Z) | Pi mechanism | Status | If GAP: smallest fix |
| --- | --- | --- | --- | --- |
| `/architect` (± checkpoint) | Grounded design. Arena sketches. Implement or stop | `skills/architect/` | EQUIVALENT | |
| `/arena` N candidates | Parallel attempts. Cross-judge. Graft. Verify | `skills/arena/` + Task worktrees. Panel from setup-pstack | EQUIVALENT | |
| `/swarm` slices/races | One PASS/ISSUES/BLOCKED report | `skills/swarm/` | EQUIVALENT | |
| `/interrogate` skeptically | Verified findings only. Dropped list | `skills/interrogate/` | EQUIVALENT | |
| Prototype playbook with screenshots/timings | Comparable running variants | `playbooks/prototype.md`. Screenshots via capture + `read` (see media row under 10) | EQUIVALENT | |
| README/tutorial-first + `/technical-writing` | Caller-view doc. Mode held | poteto-mode + `skills/technical-writing/` | EQUIVALENT | |
| Multi-phase plan after design settles | Plan-only deliverable. Per-PR proof | `playbooks/multi-phase-plan.md` | EQUIVALENT | |
| Boundary work triggers architect by default | Extra scrutiny without naming skills | poteto-mode Non-negotiables | EQUIVALENT | |

Page tip↔Pi guide text is identical. Model-family diversity for arena/swarm panels follows the Pi provider catalog (`gap-list.md` §4). Not a missing pi-pstack feature.

---

## 05-build-and-clean.md

| Workflow (A/B/C) | Expected outcome (X/Y/Z) | Pi mechanism | Status | If GAP: smallest fix |
| --- | --- | --- | --- | --- |
| Bug / Feature / Refactor / Perf prompts | Matching playbook steps and evidence bars | `playbooks/bug-fix.md` etc. | EQUIVALENT | |
| Hillclimb with metric + target | Loop hypotheses. Frozen harness. Keep wins | `playbooks/hillclimb.md` + `/benchmark-checklist` | EQUIVALENT | |
| Runtime / trace forensics. No fix | Diagnosis only | matching playbooks | EQUIVALENT | |
| `/tdd implement` | Failing test then fix, or honest closest check | `skills/tdd/` | EQUIVALENT | |
| `/typescript-best-practices` by name | TS rules loaded for the turn | `skills/typescript-best-practices/` | EQUIVALENT | |
| Opening PR cleans with `/deslop` + `/unslop` | Clean diff and prose | Tip: deslop from team-kit soft-dep. Pi: vendored `skills/deslop/` + `skills/unslop/` | EQUIVALENT | |
| `/no-comments` | Fresh Comment Sicko pass. Root-cause fixes | `skills/no-comments/` + `agents/comment-sicko.md` | EQUIVALENT | |

---

## 06-verify-and-ship.md

| Workflow (A/B/C) | Expected outcome (X/Y/Z) | Pi mechanism | Status | If GAP: smallest fix |
| --- | --- | --- | --- | --- |
| Finish condition + artifact proof in prompt | Commands/outputs or "inconclusive" | prove-it-works + poteto-mode | EQUIVALENT | |
| Visual parity when pixel match required | Screenshot baseline diff | `playbooks/visual-parity.md` | EQUIVALENT | |
| `/blast-radius` on a small untrusted diff | One safety fact proved by running code | `skills/blast-radius/` | EQUIVALENT | |
| `/benchmark-checklist` on a number | faster/slower/no-diff/inconclusive + limiter | `skills/benchmark-checklist/` | EQUIVALENT | |
| `/create-verification-skill` | `.pi/skills/verify-<app>/` with feature map. E2E proof | `skills/create-verification-skill/` (tip `.cursor/skills/`) | DOC-ONLY-DIFF | |
| `/maintain-verification-skill` | clean / changed PR / blocked. No product edits | `skills/maintain-verification-skill/` | EQUIVALENT | |
| Formal verify create + maintain | Property check + project skill + drift maintenance | formal verification skills | EQUIVALENT | |
| `/statechart` | Mermaid chart tied to TLA+ model. Repro on real code | `skills/statechart/` | EQUIVALENT | |
| Open PR playbook | Worktree. Small commits. PR link | `playbooks/opening-a-pr.md` | EQUIVALENT | |
| Babysit to merge-ready | Conflicts → threads → CI. No merge | `playbooks/babysit.md` + `scripts/watch-pr/` + `gh` / Origin CLI | EQUIVALENT | |
| Shipping land the stack | Independent verify then bottom-up land | `playbooks/shipping.md` | EQUIVALENT | |

---

## 07-overnight.md

| Workflow (A/B/C) | Expected outcome (X/Y/Z) | Pi mechanism | Status | If GAP: smallest fix |
| --- | --- | --- | --- | --- |
| Earn-trust checklist before looping | Human judgment. No host tool | docs + verify skill | EQUIVALENT | |
| Overnight contract + `/loop until done` | Re-check finish condition on wakes. Escape hatch | Tip: Cursor `/loop`. Pi: `/loop` + `Loop` tool (`src/loop.ts`) + `playbooks/autonomous-run.md` | EQUIVALENT | |
| Pause safely / restart host | Checkpoint + resume note. Session pickup | `playbooks/pause-safely.md` (Pi wording: restart Pi) | DOC-ONLY-DIFF | |
| Morning `/show-me-your-work` | TSV trail + Attention from other-family reviewer | `skills/show-me-your-work/` | EQUIVALENT | |
| `/ketchup` status | Plain catch-up + waiting calls | `skills/ketchup/` | EQUIVALENT | |
| Autopilot-full / Autopilot-stack / Orchestrate | Queue or program outcomes as playbooks define | matching playbooks + Task | EQUIVALENT | |
| Tip Cursor Project. Work continues with laptop closed | Persistent coordinator + isolated workers for a program | Pi: `projects/<slug>/{notes.md,store/}` (`src/paths.ts`, `src/sections.ts`). Workers = local worktrees. Coordinator must keep running (tmux + awake machine). Per goal, worktree mapping counts | EQUIVALENT | Operator keep-alive is documented. Not a missing Task API. |
| Tip: drag chats into Project for context | Related history available to agents | List session files in `notes.md` (Pi guide) | DOC-ONLY-DIFF | |
| Event/schedule automations (Benny pack) | Triage/repro line fires without you starting each loop | `automations/benny/` + `subscribe_*` (`src/subscriptions/`) + auto `pstack-routines-supervisor` | EQUIVALENT | |
| Subscriptions keep firing after setup chat exits | Timers/webhooks still arm | Durable store + supervisor (`src/subscriptions/durable-store.ts`, `ensure-supervisor.ts`). Proven in inventory tests | EQUIVALENT | |
| Subscriptions keep firing after machine reboot with no user agent | Same as Cursor-hosted Automations after reboot | Opt-in `packaging/install-supervisor-unit.sh --workspace <repo>` (writes launchd/systemd from the examples). Benny setup asks and runs it on yes. Not installed by `pi install` | EQUIVALENT | CLOSED: install script + Benny FOR_AGENTS / setup-benny opt-in + overnight/README pointers. |

---

## 08-principles.md

| Workflow (A/B/C) | Expected outcome (X/Y/Z) | Pi mechanism | Status | If GAP: smallest fix |
| --- | --- | --- | --- | --- |
| Mid-task steer by principle name | Agent applies named rule and cites the decision changed | 24 `skills/principle-*/` + poteto-mode Principles index | EQUIVALENT | |
| `/correct` as Encode Lessons path | Repo-level enforcement, not chat nag | `skills/correct/` | EQUIVALENT | |

Tip↔Pi guide page is identical. Principle skill count tip 24 / Pi 24 (measured).

---

## 09-make-it-yours.md

| Workflow (A/B/C) | Expected outcome (X/Y/Z) | Pi mechanism | Status | If GAP: smallest fix |
| --- | --- | --- | --- | --- |
| `/automate-me` (± update) | Personal `-mode` skill PR from transcript mining | `skills/automate-me/` + shipped `create-skill` + Pi session paths → `.pi/skills/` | DOC-ONLY-DIFF | |
| `/reflect` | Accepted/Rejected/Backlog. Wait for approval | `skills/reflect/` | EQUIVALENT | |
| `/correct` on a repeated mistake class | Architecture/type/lint/test fix with proof on past miss | `skills/correct/` | EQUIVALENT | |
| Author a skill via poteto-mode | create-skill validation + Opening a PR | Tip: Cursor builtin `create-skill`. Pi: `skills/create-skill/` (depth closed in inventory) | EQUIVALENT | |
| Verify / formal generators | Same as setup/06 | same skills | EQUIVALENT | |
| `/technical-writing` | Layered prose standard applied | `skills/technical-writing/` | EQUIVALENT | |
| Eval playbook blind candidates | Observer-effect-safe skill test | `playbooks/eval.md` | EQUIVALENT | |
| `/make-bot-ui` wake a bot from a page | Buttons POST to webhook. Key stays on server. Fires survive setup chat exit | Tip: Grok Bot. Pi: `subscribe_webhook` + auto `pstack-routines-supervisor`; reboot via `packaging/install-supervisor-unit.sh` | EQUIVALENT | |

---

## 10-recipes-and-pitfalls.md

| Workflow (A/B/C) | Expected outcome (X/Y/Z) | Pi mechanism | Status | If GAP: smallest fix |
| --- | --- | --- | --- | --- |
| Recipe prompts (how→why, sharpen, prototype, plan, arena, swarm, interrogate, tdd, verify, formal, benchmark, correct, poteto-help, overnight short form, steer, `/bro`) | Same outcomes as earlier pages | Corresponding skills/playbooks | EQUIVALENT | |
| `/ketchup` | Plain catch-up + calls | `skills/ketchup/` | EQUIVALENT | |
| `/ketchup-video` | Short subtitled video of slides + waiting calls as text | `skills/ketchup-video/` renders an mp4, opens it with the OS player (`open` / `xdg-open`), `read`s one frame per slide, names the path. Host section teaches the same (`src/sections.ts`). Pi chat still does not inline-play | EQUIVALENT | CLOSED: watchable catch-up via system player + frames. Inline Markdown playback remains unavailable and is documented honestly. |
| `/ketchup` / prototype screenshots "embedded inline" | User sees pictures in the reply surface | Tip Markdown embeds. Pi: no image in reply Markdown. `read` tool displays in image-capable terminals (`src/sections.ts`) | DOC-ONLY-DIFF | Remap preserves seeing the artifact when the terminal supports images. |
| Pitfall: parallel agents → cloud / own worktree | Isolation | Task `environment: "cloud"` (Pi guide wording) | DOC-ONLY-DIFF | |
| Other listed pitfalls | Same avoidance outcomes | skills/playbooks as cited | EQUIVALENT | |

---

## Gap rollup

| # | Page | Gap | Status | Mechanism |
| --- | --- | --- | --- | --- |
| 1 | 10 (also 07 ketchup) | `/ketchup-video` watchable catch-up without Pi inline video | **CLOSED** | Skill + host section open the mp4 in the system player, `read` one frame per slide, name the path. Guide 10 copy matches. |
| 2 | 07 | Subscriptions after **reboot** without packaging unit | **CLOSED** | `packaging/install-supervisor-unit.sh` (idempotent launchd/systemd). Benny FOR_AGENTS + setup-benny ask and run on opt-in. Overnight + README point at the script. |

**GAP count: 0** (guide-outcome GAPs). Inventory residuals that are not guide GAPs under the stated goal: local-vs-remote isolation strength, provider model catalog thinness, image-generation falling back to Mermaid/table, Cursor Computer Use / enterprise witnessing.

**DOC-ONLY-DIFF count (pages with at least one):** README, 01, 02, 03, 05→deslop packaging note, 06 paths, 07 pause/Project notes, 09 automate-me/make-bot-ui, 10 cloud wording and screenshot delivery. None of those block the taught outcome once the Pi mechanism is used.

**EQUIVALENT.** All other tip-taught A→X rows in the tables above.

---

## Method notes

- Tip vs Pi guide diffs are vocabulary and path remaps only (plugin→package, Custom Mode→`/mode`, cloud VM→worktree, `.cursor`→`.pi`, Grok Bot→Pi session webhook, deslop soft-dep→vendored). Pages 03, 04, 08 have empty `diff` bodies.
- Host registration checked against `host-feature-map.md`: Task, stop_agent, agent_status, TodoWrite, AskQuestion, visualize, subscribe_*, Loop, /mode, /plan, /loop, /routines, rule injection, projects section.
- Principles used this pass: **Prove It Works** (read tip+Pi guides and `src/` rather than trusting inventory prose alone). Reply shaped by **unslop** and **technical-writing**.
