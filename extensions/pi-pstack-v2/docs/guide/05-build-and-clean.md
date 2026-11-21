# Build the change and clean the diff

Each build playbook asks for evidence, so your prompt needs to state what you observed. This page gives a prompt for each build task and then the cleanup steps that keep a diff reviewable.

## Prompt each build playbook

A bug prompt states the symptom and asks for a reproduction first:

```text
/skill:poteto-mode this command emits two records after a retry. repro first, then fix and verify.
```

A feature prompt states the behavior and what must not change:

```text
/skill:poteto-mode add a --json flag. text output stays byte-identical. verify both forms.
```

A refactoring prompt pins behavior before the structure moves:

```text
/skill:poteto-mode move parsing into one module, zero behavior change. record the current output first and prove it's unchanged after.
```

A perf prompt states a measurement, not an impression:

```text
/skill:poteto-mode startup takes 1.8s on this fixture. trace it, fix the measured cause, show me before and after.
```

Each prompt routes to its playbook: [Bug fix](../../skills/poteto-mode/playbooks/bug-fix.md), [Feature](../../skills/poteto-mode/playbooks/feature.md), [Refactoring](../../skills/poteto-mode/playbooks/refactoring.md), or [Perf issue](../../skills/poteto-mode/playbooks/perf-issue.md). The playbook supplies the steps you did not type. It reproduces before fixing, names the data shape before implementing, pins behavior before restructuring, and profiles before optimizing.

To improve one number over many attempts, use the [Hillclimb playbook](../../skills/poteto-mode/playbooks/hillclimb.md). Give it the metric, a target, and a floor on attempts. It loops one hypothesis at a time with a frozen measurement setup. It keeps wins and reverts everything else.

Both perf playbooks run [`/skill:benchmark-checklist`](../../skills/benchmark-checklist/SKILL.md) on their numbers. Perf issue vets its baseline and every number after it. Hillclimb vets its measurement setup before freezing it. [Verify and ship](./06-verify-and-ship.md#vet-a-measured-number-with-skillbenchmark-checklist) says when to run it yourself.

To get the cause without a fix, use a forensics playbook. For a live symptom such as a leak, an idle CPU spin, or a visual glitch, the [Runtime forensics playbook](../../skills/poteto-mode/playbooks/runtime-forensics.md) instruments the running process. For a profile you already captured, the [Trace forensics playbook](../../skills/poteto-mode/playbooks/trace-forensics.md) reads the artifact and maps the hot frame to source. Both return a diagnosis, not a fix:

```text
/skill:poteto-mode here's a cpuprofile from the slow startup. tell me where the time goes and which source lines own it. no fix yet.
```

## Write the failing test first with `/skill:tdd`

When a bug has a cheap local test path, two words are enough:

```text
/skill:tdd implement
```

With the bug in context, [`/skill:tdd`](../../skills/tdd/SKILL.md) writes the smallest test that fails for the intended reason. It then writes the fix and reruns the test. If a test would need broad setup or brittle mocks, the skill says so and uses the closest executable check instead. A real command can be stronger evidence than a forced test.

## Load the TypeScript rules by name

[`typescript-best-practices`](../../skills/typescript-best-practices/SKILL.md) turns the type-system principles into concrete rules: discriminated unions, `unknown` at boundaries, exhaustive variants, and schema-derived types. It does not load on its own. Type `/skill:typescript-best-practices` when a task touches `.ts` or `.tsx` files.

## Clean before you commit

The [Opening a PR playbook](../../skills/poteto-mode/playbooks/opening-a-pr.md) runs `/skill:deslop` on the diff before each commit. [`/skill:deslop`](../../skills/deslop/SKILL.md) comes from cursor-team-kit and ships in this package. It checks the diff against main and removes slop the branch introduced:

- extra comments that are unnecessary or inconsistent with local style
- defensive checks and try/catch blocks that are abnormal for trusted code paths
- casts to `any` that only bypass type errors
- deep nesting that early returns would flatten
- other patterns inconsistent with the file and its surroundings

`/skill:poteto-mode` routes docs, pull request descriptions, and commit messages to [`/skill:technical-writing`](../../skills/technical-writing/SKILL.md), which applies [`/skill:unslop`](../../skills/unslop/SKILL.md). For other prose, run `/skill:unslop` with a target and any extra rules:

```text
/skill:unslop the readme changes, no emdashes
```

`/skill:unslop` reads intent from a terse prompt such as `unslop that, tighten it`.

## Strip the comments with `/skill:no-comments`

The agent that wrote a comment defends it, so a different reviewer should remove comments. Before review, run:

```text
/skill:no-comments the diff
```

[`/skill:no-comments`](../../skills/no-comments/SKILL.md) spawns [Comment Sicko](../../src/subagent/agents/comment-sicko.md) as a reviewer subagent worker. The skill inspects the worker's report and edits. The worker keeps only these comments:

- license headers
- doc comments on a public API
- links that explain what the code cannot
- notes on behavior that an external dependency forces

It removes every other comment. A comment that explains a surprise in your own code is a refactor flag. `/skill:no-comments` fixes the flags it accepts at the root cause. When a comment claims a constraint such as "do not remove", the skill offers to encode the claim as a type, test, or lint. The comment comes out either way.

The three cleanup skills split the work:

- `/skill:deslop` cleans slop out of code.
- `/skill:unslop` cleans slop out of prose.
- `/skill:no-comments` hands the comments to a reviewer who did not write them.

**Pitfall.** Cleanup is part of the change. A diff with narrating comments and defensive dead code looks unfinished to reviewers, and the extra code is where the next bug hides. When the diff feels padded, say `deslop it` before you commit.

Next: [Verify and ship](./06-verify-and-ship.md).
