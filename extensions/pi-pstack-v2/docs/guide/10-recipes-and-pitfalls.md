# Recipes and pitfalls

Prompts to copy, followed by common mistakes. Replace the paths and finish conditions with your own. The recipes are informal on purpose, and the skills read intent from them.

![A woman tastes a dish while robots cook at a stove and oven. Cards hanging above the counter display how, tdd, and a loop card. A box on the counter is labeled RECIPES, a chalkboard reads FOCUS BUILD REPEAT, and a screen reads context: guarded.](./images/recipes.jpg)

## Understand an unfamiliar subsystem

```text
use /skill:how first to understand how this initialization works. then use /skill:why to figure out why it broke recently.
```

`/skill:how` covers the mechanics. `/skill:why` covers the history and cites the commits and discussions it used, and says what the record does not answer.

## Restate a noisy report before touching code

```text
/skill:poteto-mode read this thread. restate the underlying issue in your own words, in plain english. don't change any code yet.
```

A misreading shows up in the restatement, where one message corrects it. Hold your own theory until the agent has stated its own. `/skill:in-your-own-words` produces the restatement alone, with no playbook.

## Sharpen a prompt before you send it

```text
/skill:sharpen write the onboarding doc for the new billing service.
```

The agent names what an expert would do that you did not ask for, the raw material they would start from, their methods and tools, and an outside check that the result is right. It returns your prompt rewritten to ask for that. It does not do the task. Send the rewrite when it reads right.

## Prototype before you pick

```text
/skill:poteto-mode prototype a few options for the settings layout. put them behind a switcher and send me screenshots of each.
```

You choose among options that run. The agent answers its own layout and timing questions along the way.

## Turn a settled design into a plan

```text
/skill:poteto-mode turn this design into a plan. small verifiable PRs, each with its own proof.
```

Ask only after the design settles. The plan file is the deliverable. The Multi-phase plan playbook does not implement it and does not name a playbook to execute it. Say where to save the file, and tell `/skill:poteto-mode` which playbook to run when you approve it.

## Get a second opinion on a design

```text
ask /skill:arena for a second opinion on this thread and our approach
```

`/skill:arena` runs the same brief on several fresh attempts, then returns one artifact that grafts the best parts onto a chosen base, with a note naming the base and grafts. Your current design is not one of the candidates. The cost is small next to a design that is expensive to reverse.

## Check independent slices in parallel

```text
/skill:swarm check every package under packages/ against its check.sh. one worker per package. one report.
```

Each worker owns one package. The `subagent` call blocks until every worker finishes; one call holds at most 8 tasks, so a larger set needs more calls. Each worker reports `PASS`, `ISSUES`, or `BLOCKED`. The parent returns one consolidated report with a table, issue lines, and gaps, not raw worker output.

## Review a branch skeptically

```text
/skill:interrogate the whole branch, but skeptically. don't change anything yet. no nitpicks unless it's an actual bug or regression in behavior.
```

"don't change anything yet" keeps the review read-only. The nitpick rule filters noise out in advance, so the verified findings are worth your time. `/skill:interrogate` also takes a design or a plan. Its adversaries run prototypes or probe the tree, and it drops every finding a run does not prove.

## Fix a bug through a failing test

```text
/skill:poteto-mode repro the duplicate write first. if there's a cheap test path, /skill:tdd it. then fix and rerun.
```

"if there's a cheap test path" matters. A test forced through brittle mocks proves less than the real command, and the playbook may say so.

## Repro and fix a report with proof

```text
/skill:poteto-mode repro this with /skill:verify-<app>. if it repros on main, fix it and show me a video as proof.
```

"if it repros on main" lets the run stop early when the bug is already gone. The video lets you check the fix before you read the diff.

## Prove a property tests rarely reach

```text
/skill:create-formal-verification-skill the retry queue. a message must never be delivered twice.
```

You get one property checked in every case within a stated scope. If the code already breaks the property, you get a counterexample in your code's terms. You also get a project skill that the next agent runs on any change to that code.

## Vet a number before you post it

```text
/skill:benchmark-checklist vet this 40% speedup before it goes in the pr description
```

The verdict is faster, slower, no measurable difference, or inconclusive. It includes the run count, the range, and what limits the number.

## Stop correcting the same mistake

```text
/skill:correct agents keep adding new config flags without registering them in the schema
```

The fix lands in the repository as architecture, a type, a lint, or a test, so the next agent cannot make the mistake.

## Ask how without starting the work

```text
/skill:poteto-help how do i get poteto-mode to stay on every turn?
```

You get an answer, a prompt to send, and a link to the source. Nothing runs until you send that prompt.

## Keep a run honest while you are away

```text
im going to bed, keep going autonomously until every fixture passes. do not stop. keep a decision log i can audit in the morning.
```

The [overnight page](./07-overnight.md) has the full contract. This short form works once the task and the finish condition are already in the conversation.

## Redirect a drifting run

Steering prompts are one line:

```text
i said the goal is to repro. i did not ask for a fix yet.
```

```text
apply prove it works. show me the real output, not the build log.
```

```text
/skill:unslop that, no emdashes
```

A principle name does most of the steering. [The principles page](./08-principles.md) lists the names.

## Get the reply in plain words

```text
/skill:bro
```

That is the whole prompt. [`/skill:bro`](../../skills/bro/SKILL.md) restates the last message in plain, shorter words, as one person would tell another. Use it when a reply is thorough but you still do not know what it said.

## Catch up on a chat you left running

```text
/skill:ketchup
```

[`/skill:ketchup`](../../skills/ketchup/SKILL.md) tells you in plain words what changed since your last message. It then lists each call waiting on you with its pick, evidence, and risk. It changes nothing while it reports.

For a video instead, run [`/skill:ketchup-video`](../../skills/ketchup-video/SKILL.md). It shows what happened in a short subtitled video of slides, and lists the calls waiting on you as text under the video.

## Pitfalls

- **Listing skills in the prompt.** "use /skill:architect then /skill:arena then /skill:interrogate" reorders steps the playbook already sequences. State the goal and constraints. Name a skill only to override a default.
- **A vague finish condition.** "make it better" gives a heartbeat nothing to check. Give a command or artifact that can pass or fail.
- **Leading with your theory of the cause.** The agent searches where you pointed. Ask it to restate the problem first, then share your theory.
- **Taking the first design.** One attempt keeps the first shape the model produced. Ask for prototypes or `/skill:architect`, and choose from evidence.
- **Polishing a plan that no code has tested.** Open questions in a plan need prototypes. Settle them first, then run `/skill:interrogate` on the plan or on what you built. Adversaries run prototypes or probe the tree, and unproven findings are dropped.
- **Parallel agents in one working tree.** They overwrite each other, and nobody can tell which agent changed what. Set `isolation: "worktree"` on the `subagent` call. Or create a worktree on the host with `tmux_run` running `git worktree add -b <branch> .pi/worktrees/<slug> <ref>` and pass its path as `cwd`. Or write "own worktree per attempt" in the prompt.
- **Looping before you trust the loop.** A loop that cannot verify its own work produces unchecked work faster. Get the verification skill working first.
- **Trusting an unvetted number.** A warm cache or a skipped code path can fake a speedup. Run `/skill:benchmark-checklist` before the number goes anywhere.
- **Correcting the same mistake by hand.** A correction in chat helps one run. `/skill:correct` fixes the repository so no later run repeats the mistake.
- **Using `/skill:arena` for coverage.** `/skill:arena` repeats one design or code brief, then picks a base and grafts the best parts. `/skill:swarm` partitions slices or declared race arms and aggregates one report.
- **Accepting every review comment.** Bots and humans file real catches and noise in one list. `/skill:interrogate` keeps only the findings that a rerun proves, and lists what it dropped and why.
- **Treating `auto` as a model.** `auto` and `inherit-parent` mean "omit the model, so the subagent worker runs on your session model." [Set up pstack](./01-setup.md#pick-your-models) covers the roles.
- **Reporting success from a green build.** A build proves the code compiles. Ask for the real command, flow, stored value, or profile, and expect the evidence in the reply.
- **Writing a `SKILL.md` freehand.** Route it through the [Authoring or modifying a skill playbook](../../skills/poteto-mode/playbooks/authoring-a-skill.md), so validation and review happen.

Back to the [guide index](./README.md).
