# Make it yours

poteto-mode is one person's style. Its playbooks, routing, and model roles work with your style too. This page covers generating a personal mode, capturing lessons from a session, fixing the repository so agents stop repeating mistakes, authoring a focused skill, and testing a skill change before you adopt it.

You do not need many skills on day one, or the whole package. Prompt plainly, note where agents fail, and add a skill or a check when the same failure appears twice.

## Generate your own mode with `/skill:automate-me`

```text
/skill:automate-me
```

[`/skill:automate-me`](../../skills/automate-me/SKILL.md) reads your style from your history, so you do not describe it. It mines your recent Pi sessions for the current working directory, under `~/.pi/agent/sessions/`. It looks for repeated preferences in replies, delegation, verification, code, prose, and process. It asks which patterns are really you. It then drafts `.pi/skills/<your-name>-mode/SKILL.md` to Pi's skills spec and checks that the draft loads with `/skill:<your-name>-mode`. It runs the draft through [`/skill:unslop`](../../skills/unslop/SKILL.md) and opens a pull request from a worktree, so you review it like any other change.

Run it again when your habits change:

```text
/skill:automate-me update my mode skill with everything since its last edit
```

Update mode mines only the history since the skill last changed. It keeps rules you have not contradicted and revises those with new evidence. It adds sections only for new patterns.

## Capture a session's lessons with `/skill:reflect`

Right after a task that taught you something, run:

```text
/skill:reflect that took way too long. capture what we learned so the next run doesn't repeat it.
```

[`/skill:reflect`](../../skills/reflect/SKILL.md) reads the transcript and keeps only lessons that would change a future agent's work. It sorts the proposals into `Accepted`, `Rejected`, and `Backlog`, and waits for your approval before changing any skill. Approve a proposal only if it would change a future decision. One unusual session is an anecdote, not a rule.

## Fix the environment with `/skill:correct`

When you correct agents for the same mistake repeatedly, the fix belongs in the repository, not in your next prompt. Rank the options by how well they hold:

1. Make the mistake impossible with architecture or a better data structure.
2. Block it with types, or with a lint or continuous integration check whose error names the fix.
3. Catch it with a test.
4. Write it down as a doc or agent rule. Nothing fails when an agent skips a rule, so this option ranks last.

Human review is not on the list. A reviewer who must catch the same mistake on every pull request is the problem that `/skill:correct` removes. [`/skill:correct`](../../skills/correct/SKILL.md) does the work:

```text
/skill:correct agents keep calling the database client directly instead of going through the repository layer
```

`/skill:correct` reads recent commits, reverts, review comments, and comments that explain workarounds. The skill groups the mistakes into classes, and a class counts once it has happened twice. It fixes the most frequent classes, one commit each, at the highest level that works. Each new check must fail on a real past mistake. The skill also keeps a table in `AGENTS.md` that pairs each rule with what enforces it, so a rule that nothing enforces shows up as a repeat. The reply lists each class with its evidence, the level chosen, and why a higher level did not work.

With no argument, it finds the classes from history on its own. `/skill:reflect` and `/skill:correct` split the work. `/skill:reflect` improves skills from one session. `/skill:correct` changes the repository so a class of mistake cannot return. Pair `/skill:correct` with `/skill:architect` when the fix is a new boundary. [Run many projects in parallel](./07-overnight.md#run-many-projects-in-parallel) has a prompt that does both across a whole repository.

## Author a focused skill

When you already know the workflow to capture:

```text
/skill:poteto-mode write a skill for verifying database migrations in this repo
```

That prompt matches the [Authoring or modifying a skill playbook](../../skills/poteto-mode/playbooks/authoring-a-skill.md). The playbook writes the `SKILL.md` to Pi's skills spec, validates the frontmatter and links, and checks that it loads with `/skill:<name>`. It ships the result through the Opening a PR playbook. Agent-facing prose has a higher bar than human prose, because an unhelpful sentence becomes an instruction that a future agent follows. The playbook holds that bar, so do not write a `SKILL.md` freehand.

Two kinds of skill have their own generators:

- A skill that drives your app and proves behavior is a verification skill. Use [`/skill:create-verification-skill`](../../skills/create-verification-skill/SKILL.md) and [`/skill:maintain-verification-skill`](../../skills/maintain-verification-skill/SKILL.md).
- A skill that checks a property of your code with a model checker, a proof, or another verifier is a formal verification skill. Use [`/skill:create-formal-verification-skill`](../../skills/create-formal-verification-skill/SKILL.md) and [`/skill:maintain-formal-verification-skill`](../../skills/maintain-formal-verification-skill/SKILL.md).

[Verify and ship](./06-verify-and-ship.md#prove-a-property-with-a-formal-verification-skill) covers both.

## Write docs to a standard with `/skill:technical-writing`

For docs, RFCs, readmes, pull request descriptions, and commit messages, run:

```text
/skill:technical-writing review the readme changes
```

[`/skill:technical-writing`](../../skills/technical-writing/SKILL.md) applies a layered standard. Its goal is prose that a tired engineer understands on the first read. It picks the document's mode first: tutorial, how-to, reference, or explanation. It then works sentence by sentence on who does what, one thought per sentence, and nothing that reads two ways. Use it to review what you or an agent just wrote, or name it when you ask for a doc.

## Test a skill change blind

A skill edit affects every later session, so test it like an experiment. Test someone else's skill the same way before you adopt it.

```text
/skill:poteto-mode run the eval playbook on this skill change. same task for both variants, candidates stay blind.
```

When a skill keeps missing and you know what it should do, change and test it in one task:

```text
/skill:poteto-mode update the review skill so it flags missing migrations, and eval the change.
```

Asking for the eval up front keeps the edit honest. A fix written from one bad session can overfit that session, and the skill drifts over many edits. The eval catches the drift before it ships.

The [Eval playbook](../../skills/poteto-mode/playbooks/eval.md) guards against the observer effect: an agent that knows it is being evaluated behaves differently. Candidate agents get an organic-looking task in sanitized directories. They never see the words "eval" or "candidate", and they never learn that other candidates exist. One judge scores all outputs under neutral labels. The playbook grades chain-following from the diff in each candidate's worktree and the shape of the code. Workers have no session and no tool-call log, so it cannot grade from which files a candidate read, and it ignores what the candidate claims.

Read every output yourself before you accept the verdict. If you disagree with the judge, check the rubric before you doubt your own judgment.

## Build a wake UI with `/skill:make-bot-ui`

[`/skill:make-bot-ui`](../../skills/make-bot-ui/SKILL.md) builds a small page whose buttons wake a Pi session. For example, you can swipe through a review queue and have each swipe ask the session to act on that item. The server on your machine holds every secret, passed through environment variables such as `<SLUG>_KEY`. No secret reaches the browser or the chat. The skill also covers exposing the page on Tailscale.

**Pitfall.** Do not edit a skill mid-task because it misbehaves. Fix it in its own pull request and keep the task moving. A skill edit tangled into feature work is invisible to review and cannot be evaluated.

Next: [Recipes and pitfalls](./10-recipes-and-pitfalls.md).
