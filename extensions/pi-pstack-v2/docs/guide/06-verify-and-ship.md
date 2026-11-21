# Verify the result and open a pull request

"It compiles" is not evidence. The [Prove It Works principle](../../skills/principle-prove-it-works/SKILL.md) makes the agent check the real artifact before it reports success. Your part is to make that artifact checkable. This page covers finish conditions, vetting a measured number, generating a verification skill for your app, formally verifying a property, opening a pull request, and driving it to merged.

Verification is the slowest step when it waits on a human. When the agent can verify its own work, you stop being the bottleneck. When it cannot, more agents only produce more unchecked work for you to review.

![A prototype plane flies a test course over a wet runway. A woman holds a stopwatch while robots film the flight and hold a checklist. A laptop screen reads verify: pass and evidence: captured.](./images/verification.jpg)

## State the finish condition up front

Put what done means in the first prompt:

```text
/skill:poteto-mode add json output to this command. text output stays byte-identical, the json parses, both run against the sample project. show me the evidence.
```

The agent now has three checks to run. The reply should carry the exact commands and their outputs. If a check could not run, a good reply says "inconclusive". A confident reply without evidence is a warning sign.

Match the check to the change:

- A CLI change runs the real command.
- A UI change walks the changed flow in the running app. When the UI must match a reference pixel for pixel, the [Visual parity playbook](../../skills/poteto-mode/playbooks/visual-parity.md) diffs screenshots against a frozen baseline.
- A parser or migration replays a saved input.
- A perf change compares before and after profiles.
- A storage change reads back the written value.

Ask for the proof as an artifact you can inspect: the failing test and then the passing one, a before-and-after video, the trace, or the screenshot. If the fix already merged, ask for the same check on main. You can challenge an artifact without replaying the whole run.

For a small diff you do not fully trust, [`/skill:blast-radius`](../../skills/blast-radius/SKILL.md) finds what the diff could break elsewhere. It finds the one fact that makes the change safe and proves that fact by running code.

## Vet a measured number with `/skill:benchmark-checklist`

A before-and-after number is often wrong. A warm cache, a debug build on one side, or work that never ran inside the timed region can each produce a convincing speedup. Before you report or act on a number, type:

```text
/skill:benchmark-checklist vet the export speedup before it goes in the pr
```

[`/skill:benchmark-checklist`](../../skills/benchmark-checklist/SKILL.md) asks seven questions and wants evidence from a run for each:

1. What limits the number, and why isn't it double?
2. Did every side run tuned the way production runs?
3. Does the result break a physical limit, such as disk bandwidth or core count?
4. Did anything error or return wrong output?
5. Does it reproduce over alternating runs, with a median and a range?
6. Does it matter end to end, on the path a user waits on?
7. Did the work happen inside the timed region?

The verdict is faster, slower, no measurable difference, or inconclusive. It includes the run count, the range, and the limiter. The verdict is inconclusive when the skill cannot name the limiter or a side ran untuned. The Perf issue and Hillclimb playbooks already run the checklist. Run it yourself when you measured something outside them, or when someone else's number looks too good. It is the working form of the [Explain the Number principle](../../skills/principle-explain-the-number/SKILL.md).

## Create a project verification skill

A UI check needs a scripted way to drive your app. If your project has one, use it. If not, run:

```text
/skill:create-verification-skill
```

[`/skill:create-verification-skill`](../../skills/create-verification-skill/SKILL.md) interviews the repository, not you. It works out what a user touches and how the app launches locally. It picks a way to drive the app, preferring an existing test script. Otherwise it picks a browser driven over the Chrome DevTools Protocol, a pseudo-terminal, or plain HTTP. It also decides what evidence proves behavior and whether two instances can run side by side. It asks you only what the code cannot answer.

It writes `.pi/skills/verify-<app>/`. The skill has Launch, Doctor, Drive, Evidence, and Cleanup sections, and a Helpers section for any script it ships. A feature map under `features/` indexes what the app does and which result proves each feature works. A [worked feature-map example](../../skills/create-verification-skill/references/feature-map-example/) shows a README index and one file per feature with the four required H2 headings.

Before handing the skill over, the generator proves it once end to end. It launches the app, runs the doctor check, drives one feature, captures evidence, cleans up, and confirms the evidence survived the cleanup. If that proof fails, do not use the output.

After that, "verify it in the app" is a step any agent can run in this repository. Name the skill in the prompt when you want the proof in a specific form:

```text
/skill:poteto-mode build the bulk-archive action. use /skill:verify-<app> to verify your changes and show me a video and screenshots as proof.
```

```text
/skill:poteto-mode repro this with /skill:verify-<app>. if it repros on main, fix it and show me a video as proof.
```

Once the verification skill works, [`/skill:swarm`](../../skills/swarm/SKILL.md) can split a full pass by feature-map entry and aggregate the results. A swarm of verifiers can also confirm a perf win over a large sample, or fuzz the app for regressions before a pull request ships.

Treat the verification skill as shared infrastructure and commit it, so every person and agent drives the app the same way. Then [build the lever](../../skills/principle-build-the-lever/SKILL.md). When agents keep writing throwaway scripts to click through the app, ask for a small control CLI that the skill calls. That CLI saves tokens and makes every run repeatable. A CLI that agents use well has these traits:

- A few composable commands that each do real work, instead of many thin ones.
- A `--dry-run` option on anything destructive.
- Subcommands that reveal features gradually.
- Error messages that say what to do next.
- Rich `--help` text.
- Machine-readable output, such as JSON.

Make the dev setup repeatable too, with seeded data, test users, and one command that brings the environment up the same way every time.

## Keep the verification skill current

Apps change, and feature maps go out of date. Run:

```text
/skill:maintain-verification-skill
```

[`/skill:maintain-verification-skill`](../../skills/maintain-verification-skill/SKILL.md) audits the generated skill. One read-only subagent worker per feature reads the source in parallel. Then one live pass drives every mapped feature. The audit ends in one of three outcomes:

- `clean` means full coverage and nothing to ship.
- `changed` means one pull request of proven corrections, confined to the verification skill's own directory.
- `blocked` names the blocker.

It never edits product code. If the live pass catches a product regression, it reports the regression instead of hiding it with a documentation edit.

To run the audit on a schedule you choose, start a heartbeat with `tmux_run`. Set `command` to `sleep <seconds>`, set `wake` to the maintenance prompt, and set `repeat: true`:

```text
name: verify-maintenance
command: sleep <seconds>
wake: read the maintain-verification-skill skill and run it
repeat: true
```

A cron entry that runs `pi -p` also works when the schedule must outlive your session. Stop a heartbeat with `tmux_jobs` and `action: "stop"`.

## Prove a property with a formal verification skill

A verification skill proves the paths you drive. Some bugs sit on paths nobody drives, such as two retries that overlap, a lock that expires mid-write, or a state change that arrives out of order. Tests rarely reach those cases. For code where such a bug is costly, run:

```text
/skill:create-formal-verification-skill
```

[`/skill:create-formal-verification-skill`](../../skills/create-formal-verification-skill/SKILL.md) picks the target from the code. The target is a promise the code makes, where a break harms users and tests rarely reach the case that breaks it. It picks the strongest target, not the easiest one to verify. Name an area or a bug to start there instead:

```text
/skill:create-formal-verification-skill the job lease and retry logic. a job must never run twice at once.
```

The question picks the tool:

- Whether events can happen in a bad order suits a model checker over a small model of the design. TLA+, a specification language for concurrent systems, is the default for that, in any language.
- Whether the code behaves for every input suits a verifier that runs on the code.
- If no verifier runs on your language, the agent says so and tests the real code with generated inputs, not a hand-written model of the function.
- A property that must hold at every size can need a proof.

The agent tells you which tool it chose and why.

It verifies one property and shows that property failing on a broken variant of the code. A check you have never seen fail proves nothing. When the current code already breaks the property, you get the counterexample as a short sequence of steps in your code's terms. The property stays as stated, so the finding stays a finding. Product code does not change unless you ask.

The skill writes a project skill that tells the next agent whether a change touches the verified code. It also gives the one-command check and how to tell a real bug from a modeling error. Before handing it over, the generator follows that skill once on a scratch change that breaks the property, and the check must catch it. The handoff states what was verified, with which tool and bounds, what the check found, and what it does not cover. A pass covers the model or the bound, not the whole system.

The skill also records which code each check covers and the commit where the check last matched it. A merge or refactor that skips the skill can leave the check passing on a description of code that no longer exists. After such a change, run [`/skill:maintain-formal-verification-skill`](../../skills/maintain-formal-verification-skill/SKILL.md). It updates the verification from the code and reruns it. It shows that each updated check can still fail. It also tells you whether each failure is drift in the verification or a bug in the code.

## Show the behavior as a statechart

A counterexample in model terms convinces you. The product manager or designer who owns the behavior needs it in their terms. Run:

```text
/skill:statechart what the user sees when they edit a note offline
```

[`/skill:statechart`](../../skills/statechart/SKILL.md) draws a Mermaid statechart of what the user sees. It generates the chart from a TLA+ model, so the picture and the checked model cannot drift apart. The reader's rules, such as "you never see Synced while you're offline", become invariants. The chart marks each state that breaks a rule, and the report gives the shortest path to it in the reader's words. Before the handoff, the agent reproduces each bug path in the real code, so a modeling error does not reach the reader as a bug.

## Open the pull request

```text
/skill:poteto-mode open the pr. small ordered commits, evidence in the description.
```

The [Opening a PR playbook](../../skills/poteto-mode/playbooks/opening-a-pr.md) works from a worktree and rebases the work into small commits. It cleans the diff and writes a one-minute briefing as the body. It opens the pull request ready for review. Stacked follow-ups work better than a growing branch.

## Drive the pull request to merge-ready with Babysit

An open pull request collects blockers: checks fail, reviewers comment, and trunk moves. Hand that work to the [Babysit playbook](../../skills/poteto-mode/playbooks/babysit.md):

```text
/skill:poteto-mode babysit this pr. get it green.
```

Babysit watches the pull request with a `tmux_run` watcher that wakes your session when a check or comment changes. It reads the pull request through `gh` by default, or through the Origin CLI when it is available. It takes blockers in order: conflicts, then review threads, then continuous integration failures. It never rebases or force-pushes. A conflict or a stale base comes back to you with the branch that needs the rebase.

Babysit triages comments skeptically, because humans and bots file real catches and noise in the same list. A real finding gets a fix. Noise gets dismissed, with the disproof posted on the thread. When you only want status, ask a smaller question and Babysit answers without starting the loop:

```text
/skill:poteto-mode check on pr 123. anything outstanding?
```

Babysit stops at merge-ready and never merges, because merging is a separate decision.

## Land the stack with Shipping

Green checks do not prove a change is safe. When you are ready to land, say so:

```text
/skill:poteto-mode land the stack.
```

The [Shipping playbook](../../skills/poteto-mode/playbooks/shipping.md) verifies each pull request independently before it arms anything. One fresh subagent worker per pull request proves the behavior live, so the agent that judges a change never wrote it. Shipping then lands only the contiguous verified run from the bottom, one pull request at a time. It uses `gh` by default, or Origin when its CLI is available. It reports the first pull request that breaks the chain. A verified pull request above an unverified one waits, because merging it would pull the gap in underneath.

Next: [Run work overnight](./07-overnight.md).
