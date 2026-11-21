---
name: poteto-help
description: Guides users through pstack setup, /skill:poteto-mode, and picking the skill, playbook, or principle for a task. Type /skill:poteto-help with a question.
disable-model-invocation: true
---

# Poteto help

Answer the user's question about pstack, hand them a prompt they can send, and link the file the answer came from. For a help question, don't start the work. The user asked how, and a pstack run spends real tokens, so let them send the prompt.

A message that asks for work, such as "use pstack to fix this bug", is not a help question. Read [`poteto-mode`](../poteto-mode/SKILL.md), do the work under it, and mention once that `/skill:poteto-mode` applies to the message it is typed in, so each new task should start with it.

This file maps questions to the skills and guide pages that hold the answers. Those files own the details. Read the file you route to before you quote it, and trust it when it disagrees with this map. The links here point into the installed package. Read them from disk, and give the user a file's path relative to the package root.

## Find out what they need

Infer the need from the message and the conversation. A named situation, such as "which skill reviews a PR?", goes straight to its section. If the need is still unclear, ask one question in plain text with these numbered options, end your turn, then answer only the section they pick:

1. Get set up
2. Start a task with `/skill:poteto-mode`
3. Pick a skill for a situation
4. Fix a run that went wrong
5. Make pstack my own

Check the state that changes the answer, and mention it only when it does:

- No `~/.pi/agent/pstack-v2-models.md` means `/skill:setup-pstack` hasn't run for this user, so every role runs on the session model.
- No `verify-*` skill or other app harness in the project means agents have no scripted way to drive the app. Mention `/skill:create-verification-skill` when the question is about proving a change works.
- No formal verification skill in the project means no property is checked past what tests reach. Mention `/skill:create-formal-verification-skill` when the question is about a race, an invariant, or another case tests rarely hit. When one exists and the code it covers changed after the commit it records as last in sync, mention `/skill:maintain-formal-verification-skill` if the question touches that code.

When the models file is missing and it matters, ask whether the user wants to pick a model for each role and a reasoning budget now. It matters when the user is new, the question is about setup or cost, or the answer depends on which models run. Ask at most once per chat. If the need is also unclear, ask both questions together. Offer two numbered choices:

1. Now: give them `/skill:setup-pstack` to type, and answer their question too.
2. Later: answer their question, and add one line saying every role runs on the session model until they run `/skill:setup-pstack`.

## Get set up

1. Install with `pi install <source>`, where `<source>` is where the package lives, and check it with `pi list`.
2. Run [`/skill:setup-pstack`](../setup-pstack/SKILL.md). It asks for a reasoning budget, maps a model to each role, and writes `~/.pi/agent/pstack-v2-models.md`. The file applies from the next message. Then it offers once each to generate a verification skill and a formal verification skill for the project, unless the project already has one.
3. Start a real task with `/skill:poteto-mode`, a goal, and a check that can pass or fail.

Installing changes nothing until the user invokes a skill. Only `/skill:setup-pstack` loads from the user's words. The [README](../../README.md) and [guide page 1](../../docs/guide/01-setup.md) have the details. Offer to word their first prompt with them, per [`references/prompting.md`](references/prompting.md).

If cost is the worry, say where the tokens go and how to spend fewer. pstack spends extra tokens on spawned Pi workers and review panels. Rerun `/skill:setup-pstack` and pick a smaller budget or cheaper models. A role set to `auto` or `inherit-parent` runs on the session model, which saves tokens when the session runs on a cheaper model. A shorter panel list runs fewer spawned Pis, one for each entry. Save `/skill:poteto-mode` for work that needs rigor.

pstack was ported from Cursor and runs on Pi as a Pi package. [How pstack maps onto Pi](../../docs/pi-mechanisms.md) lists what each part uses.

Other tools can read the skills, because they use the Agent Skills format. But most workflow skills, including `/skill:poteto-mode`, `/skill:how`, and `/skill:teach`, spawn Pi workers with `subagent`, some with per-role models, and watchers and heartbeats run through `tmux_run`. Those tools come from this package's extension, so those parts may not work elsewhere.

## Start a task with `/skill:poteto-mode`

`/skill:poteto-mode` matches the task to a playbook, copies the playbook's steps into `TODO.md`, and runs the other skills as the steps need them. A good prompt states the goal and how to tell it's done. It doesn't list skills, because a hand-written sequence tends to drop or reorder steps the playbook would keep. Read [`references/prompting.md`](references/prompting.md) before you help word one. [Guide page 2](../../docs/guide/02-poteto-mode.md) has examples.

`/skill:poteto-mode` attaches the skill to one message, and it fades as the session moves on. To keep it on for the whole session, type `/pstack-mode poteto-mode` (or `/pstack-mode poteto-mode <goal>` to activate and start in one shot). That is pstack's Custom Mode. The skill rides in the system prompt every turn, survives `/compact`, and comes back when you resume the session. `/pstack-mode off` ends it. Any pstack skill works as a mode.

Point the user to Pi's skills documentation (`docs/skills.md` in the Pi package, or Pi's docs site) when this comes up. Mid-session, "new task" makes the skill match a fresh playbook. `/skill:poteto-mode` already uses `poteto-agent` for the workers its playbook steps spawn. To get the same style from a worker of your own, start it with `subagent` and `agent: "poteto-agent"`.

## Pick a skill

The default answer is `/skill:poteto-mode`, which runs most of the others when its steps need them. Name a skill directly when the user wants more or less of something than the playbook gives. Read the skill before you recommend it, and give one example prompt.

| The user wants to | Skill |
|---|---|
| Do any non-trivial task with rigor | [`/skill:poteto-mode`](../poteto-mode/SKILL.md) |
| Check that the agent understood their goal and the problem before it starts | [`/skill:in-your-own-words`](../in-your-own-words/SKILL.md) |
| Get a prompt rewritten deeper, not bigger, before sending it: what a top professional would add, their raw material and methods, and an outside check. It returns the prompt and doesn't do the task | [`/skill:sharpen`](../sharpen/SKILL.md) |
| Know how code works now, or where new code should live | [`/skill:how`](../how/SKILL.md) |
| Know why code is shaped this way, or where a number came from | [`/skill:why`](../why/SKILL.md) |
| Understand a change or subsystem, explained plainly | [`/skill:teach`](../teach/SKILL.md) |
| Catch up on their own recent work on a topic | [`/skill:recall`](../recall/SKILL.md) |
| Catch up on what changed in this chat since their last message, in plain words and small visuals, with every item waiting on them listed and decidable from the reply alone | [`/skill:ketchup`](../ketchup/SKILL.md) |
| Catch up like `/skill:ketchup`, in a short subtitled video of slides, with the waiting calls as text under it | [`/skill:ketchup-video`](../ketchup-video/SKILL.md) |
| Know what a small diff could break outside itself | [`/skill:blast-radius`](../blast-radius/SKILL.md) |
| Settle types and module shape before code that crosses a function boundary | [`/skill:architect`](../architect/SKILL.md) |
| Get several attempts at one brief, merged into the best one | [`/skill:arena`](../arena/SKILL.md) |
| Run parallel checks over slices, or race workers, as separate spawned Pis | [`/skill:swarm`](../swarm/SKILL.md) |
| Have different models review a diff and try to break it | [`/skill:interrogate`](../interrogate/SKILL.md) |
| Fix a bug test-first when a cheap local test exists | [`/skill:tdd`](../tdd/SKILL.md) |
| Apply TypeScript rules to `.ts` or `.tsx` work | [`/skill:typescript-best-practices`](../typescript-best-practices/SKILL.md) |
| Strip comments before review, using a reviewer that didn't write them | [`/skill:no-comments`](../no-comments/SKILL.md) |
| Clean AI tells out of prose | [`/skill:unslop`](../unslop/SKILL.md) |
| Write docs, an RFC, a README, a PR description, or a commit message to a standard | [`/skill:technical-writing`](../technical-writing/SKILL.md) |
| Hear the last reply again in plain words | [`/skill:bro`](../bro/SKILL.md) |
| Give agents a scripted way to drive the app and prove behavior | [`/skill:create-verification-skill`](../create-verification-skill/SKILL.md) |
| Bring a verification skill and its feature map back in line with the app | [`/skill:maintain-verification-skill`](../maintain-verification-skill/SKILL.md) |
| Formally verify a race, invariant, or other property that tests rarely reach | [`/skill:create-formal-verification-skill`](../create-formal-verification-skill/SKILL.md) |
| Bring a formal verification back in line after the code it covers changed, and learn whether a failure is drift or a bug | [`/skill:maintain-formal-verification-skill`](../maintain-formal-verification-skill/SKILL.md) |
| Show a PM or designer what the user sees as a chart checked by a TLA+ model, with the shortest path to each state that breaks a rule | [`/skill:statechart`](../statechart/SKILL.md) |
| Vet a performance number before reporting or acting on it | [`/skill:benchmark-checklist`](../benchmark-checklist/SKILL.md) |
| Run a large or cross-cutting change, or one to review after stepping away | [`/skill:figure-it-out`](../figure-it-out/SKILL.md) |
| Keep a decision log during a run, and review it afterward | [`/skill:show-me-your-work`](../show-me-your-work/SKILL.md) |
| Pick a model for each role and a reasoning budget | [`/skill:setup-pstack`](../setup-pstack/SKILL.md) |
| Turn their own working habits into a personal mode skill | [`/skill:automate-me`](../automate-me/SKILL.md) |
| Turn what a finished task taught into skill edits | [`/skill:reflect`](../reflect/SKILL.md) |
| Stop agents from repeating the same mistakes in this repo | [`/skill:correct`](../correct/SKILL.md) |
| Build a page whose buttons wake a Pi session through a local server | [`/skill:make-bot-ui`](../make-bot-ui/SKILL.md) |
| Find their way around pstack | `/skill:poteto-help` |

If a skill directory next to this one is missing from the table, read its frontmatter and route by its description. The `principle-*` directories are covered under principles below.

Close calls:

- `/skill:how` explains what the code does. `/skill:why` explains the reasons. `/skill:teach` runs one or both and explains the result plainly.
- `/skill:arena` gives every worker the same brief and merges the best parts. `/skill:swarm` splits work into slices or a race and returns one report.
- `/skill:interrogate` reviews the diff. `/skill:blast-radius` looks for breakage outside the diff and proves the one fact that makes the change safe.
- `/skill:recall` rebuilds context across recent chats. `/skill:ketchup` covers only this chat since the user's last message. Resuming one specific chat or branch is the Session pickup playbook.
- `/skill:figure-it-out` designs one rigorous run. The Autonomous run playbook drives one task to a finish condition.

Also shipped by `pi-pstack-v2`:

- `/skill:deslop`, `control-cli`, and `control-ui` come from the cursor-team-kit skills this package also bundles.
- `/loop` (with `tmux_run` `notify_on_output`), `/plan` (read-only planning mode writing under `plans/<slug>.md`), `/create-skill` (authoring + `validate`), and `/automate` (local fail-closed automations) ship as Pi-native slash commands.
- Dormant Benny automation instructions live under `automations/benny/` and are intentionally not registered as slash skills.
- pstack has no `/orchestrate` skill. If the slash menu shows `/orchestrate`, another package provides it.

## Playbooks and principles

Playbooks are step lists inside `/skill:poteto-mode`, not skills, so they have no slash command. Inside `/skill:poteto-mode`, describing the task picks one, and these phrases name one directly:

- "babysit this pr" or "check on pr 123" runs Babysit. It drives the PR to merge-ready and stops there. It doesn't merge unless the user asks to merge, land, or ship.
- "land the stack" runs Shipping.
- "take over this branch" runs Session pickup.
- "pause safely" runs Pause safely.
- "full autopilot on this queue" runs Autopilot-full. "autopilot, don't merge" runs Autopilot-stack.
- "run the eval playbook" runs Eval.

Without `/skill:poteto-mode`, a phrase such as "babysit this pr" can load a different skill for the same job instead. The Playbooks section of [`poteto-mode`](../poteto-mode/SKILL.md) lists every playbook. [Guide page 6](../../docs/guide/06-verify-and-ship.md) covers opening, babysitting, and landing a PR.

pstack has no planning skill. A plan is a Markdown file the user reviews. For work that spans phases or stacked PRs, asking `/skill:poteto-mode` for a plan runs the [Multi-phase plan playbook](../poteto-mode/playbooks/multi-phase-plan.md), which writes the plan file and doesn't implement it. For a design question, the Prototype playbook or `/skill:architect` settles it in code first.

Principles are one-rule skills that `/skill:poteto-mode` reads and cites in its replies. The user rarely invokes one. They steer with the names instead, as in "apply prove it works. show me the real output." Typing `/skill:principle-<name>` still loads one on demand. [Guide page 8](../../docs/guide/08-principles.md) lists them.

## Fix a run that went wrong

| Symptom | Fix |
|---|---|
| The mode stopped applying after a few turns | It attaches to one message. Start each task with `/skill:poteto-mode`. |
| A question got treated as the next step of the last task | Say "new task", or say the turn doesn't need the mode. |
| A new model choice had no effect | The file from `/skill:setup-pstack` is read at the start of each turn. Send a new message, and check the role has a line in `~/.pi/agent/pstack-v2-models.md`. |
| Runs cost more than expected | See the cost paragraph under Get set up. |
| A skill didn't load on its own | Only `/skill:setup-pstack` loads from the user's words. The others load when the user types them or when `/skill:poteto-mode` runs them, and it doesn't run every skill. |
| Parallel workers overwrote each other | Give each worker its own worktree. Create it with `tmux_run` running `git worktree add -b <branch> .pi/worktrees/<slug> <ref>` inside the working directory, then pass that path as the worker's `cwd`. |
| An overnight run moved but finished nothing | A `tmux_run` heartbeat needs a check that can pass or fail, not a duration. See [guide page 7](../../docs/guide/07-overnight.md). |
| The reply claims success from a green build | Ask for the real command, flow, stored value, or profile. That's the prove-it-works principle. |

For a run that drifts, [`references/prompting.md`](references/prompting.md) has one-line steers. [Guide page 10](../../docs/guide/10-recipes-and-pitfalls.md) has more pitfalls and the recipes worth copying.

## Make pstack my own

- [`/skill:automate-me`](../automate-me/SKILL.md) drafts a personal mode skill from the user's own history, to use alongside `/skill:poteto-mode`.
- [`/skill:reflect`](../reflect/SKILL.md) after a session turns its lessons into skill edits the user approves.
- `/skill:poteto-mode write a skill for <workflow>` runs the authoring playbook. The eval playbook tests a skill change blind.
- Fix a misbehaving skill in its own PR, not inside the feature work where it went wrong.

[Guide page 9](../../docs/guide/09-make-it-yours.md) covers each of these.

## Reply

Lead with the answer. Give at most one example prompt in a code block, adapted from [`references/recipes.md`](references/recipes.md) when one fits, then the link to that file. Keep it short unless the user asked for the whole map.
