# Understand the code before changing it

An agent fails in one of two ways. It misreads what you want, or it lacks the context to do the work right. [What goes in a prompt](./02-poteto-mode.md#what-goes-in-a-prompt) handles the first failure. The skills on this page handle the second.

- `/skill:how` explains what the code does now.
- `/skill:why` finds the reasons it has its shape.
- `/skill:teach` combines both into one explanation.
- `/skill:recall` rebuilds your own recent context on a topic.

Each skill makes the agent explain itself in words you can check.

![A detective studies a machine blueprint with a magnifying glass while robots fetch case files. On the evidence board behind her, red string links clues to cards labeled how and why.](./images/understanding.jpg)

## Start with a read-only investigation

When the cause is unclear, ask for findings, not a fix:

```text
/skill:poteto-mode investigate why the nightly jobs time out every few hours. give me what we know, what data you used, and your best hypotheses. don't change any code yet.
```

"don't change any code yet" routes the prompt to the [Investigation playbook](../../skills/poteto-mode/playbooks/investigation.md). The playbook traces the code, adds `/skill:why` for questions about motivation, and returns a cited explanation. For a choice between options, it returns a recommendation and a trade-offs table. Asking "what data you used" makes the agent separate evidence from guesses. When the findings point at a fix, start the fix as a new task.

## Trace behavior with `/skill:how`

```text
/skill:how do we dedupe notifications? is there an n+1 when we look up subscribers?
```

Ask the question you have. [`/skill:how`](../../skills/how/SKILL.md) reads the code and answers at the level of a senior engineer onboarding you onto the subsystem. The answer covers the runtime flow, the key types, and the non-obvious parts. The skill starts one read-only subagent worker that explores the code and writes the explanation.

## Find the history with `/skill:why`

```text
/skill:why was the retry limit set to five? does the reason still hold?
```

[`/skill:why`](../../skills/why/SKILL.md) answers from the record, not the code. It reads the commits and pull request discussions that introduced the code and each later change. It looks at other sources when that trail is thin. The answer cites what the authors wrote and marks the agent's own inferences as inferences. It also says what the record does not answer, because "nobody wrote down why" is an answer.

The two skills combine well. When you suspect the history explains a problem in the code, send `do why first then how`.

## Get a full explanation with `/skill:teach`

```text
/skill:teach me how this PR changes retries. convince me it fixes the cause and not the symptom.
```

[`/skill:teach`](../../skills/teach/SKILL.md) is for when a summary is not enough. It runs `/skill:how` and `/skill:why`, or one of them for a small change. It then builds a plain explanation diagram by diagram. "convince me" turns the explanation into an argument you can test.

It also explains the agent's own choices:

```text
/skill:teach me why you implemented it this way and not with a queue. what did you trade off, and why?
```

An agent that must explain its work has to read the code and back each claim with evidence.

## Rebuild your own context with `/skill:recall`

```text
/skill:recall catch me up on the export work from last week
```

[`/skill:recall`](../../skills/recall/SKILL.md) mines your recent Pi sessions and the shared record, such as issues, prior fixes, and errors still firing. It returns a brief on where things stand and what comes next. A fresh agent lacks the context in your old sessions, so load it first and then add the new input:

```text
/skill:recall my work on the virtualized list from yesterday, then read this bug report.
```

To resume one specific session, use the Session pickup playbook below instead.

## Take over prior work with Session pickup

When another agent, or you last week, left a branch half finished:

```text
/skill:poteto-mode take over this branch. read the decision log, figure out what's done, and continue from there. don't redo finished work.
```

The [Session pickup playbook](../../skills/poteto-mode/playbooks/session-pickup.md) treats the prior trail as authoritative. It reconstructs the branch state and decisions and names the resume point. It checks inherited claims against the original goal instead of re-deriving everything.

**Pitfall.** Do not skip these skills because "the agent will read the code anyway". An agent that edits without a traced model fixes the symptom at the first plausible spot. Running `/skill:how` first costs less than the second bug.

Next: [Design the change](./04-design.md).
