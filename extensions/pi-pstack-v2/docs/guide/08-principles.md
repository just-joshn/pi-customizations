# Steer with principle names

pstack ships 24 principles as individual skills. When `/skill:poteto-mode` applies a principle, it reads that principle's skill in full. It names each applied principle in its reply, together with the decision the principle changed. `/skill:figure-it-out` starts by reading the Principles section of `/skill:poteto-mode`.

You do not invoke principles. You cite their names. Each name points at a complete rule the agent can read, so one phrase redirects the work more precisely than a paragraph of instructions.

## Steer with a name

These prompts each cite one principle.

The agent is about to add a new adapter on top of three existing ones:

```text
use subtract before you add. delete the obsolete adapters first, then design what's left.
```

The agent claims success because the build passed:

```text
apply prove it works. run the real import flow and show me the written records.
```

Two parallel attempts are about to write to the same branch:

```text
separate before serializing shared state. give each attempt its own worktree, no locks.
```

The agent must still say which decision the rule changed. A principle citation with no decision behind it means the agent named the rule without applying it.

## The 24 principles

The core principles decide how much to build and when to rethink the design:

- [Laziness Protocol](../../skills/principle-laziness-protocol/SKILL.md) prefers deletion and the smallest change that solves the problem.
- [Foundational Thinking](../../skills/principle-foundational-thinking/SKILL.md) chooses the core data structures before writing logic.
- [Redesign from First Principles](../../skills/principle-redesign-from-first-principles/SKILL.md) integrates a new requirement as if it had been there from the start.
- [Attack the Premise](../../skills/principle-attack-the-premise/SKILL.md) writes down the premise that two or more failed fixes shared and tests it directly before the next fix.
- [Subtract Before You Add](../../skills/principle-subtract-before-you-add/SKILL.md) removes dead weight before building on top of it.
- [Minimize Reader Load](../../skills/principle-minimize-reader-load/SKILL.md) collapses layers and hidden state that a reader must hold in their head.
- [Outcome-Oriented Execution](../../skills/principle-outcome-oriented-execution/SKILL.md) converges rewrites on the target design and drops throwaway compatibility states.
- [Experience First](../../skills/principle-experience-first/SKILL.md) chooses the user's result over implementation convenience.
- [Exhaust the Design Space](../../skills/principle-exhaust-the-design-space/SKILL.md) builds two or three competing prototypes when there is no precedent.
- [Build the Lever](../../skills/principle-build-the-lever/SKILL.md) builds the script that does or proves the work, so a reviewer can rerun it. When an agent keeps doing the same thing by hand, have it write the tool or skill it needs. When a script can do a step the same way every time, use the script and keep agents for judgment calls.

The architecture principles decide where state, validation, and compatibility live:

- [Model the Domain](../../skills/principle-model-the-domain/SKILL.md) encodes repeated rules in one structure instead of scattered conditionals.
- [Boundary Discipline](../../skills/principle-boundary-discipline/SKILL.md) validates at the boundary and trusts internal types.
- [Type System Discipline](../../skills/principle-type-system-discipline/SKILL.md) makes illegal states unrepresentable.
- [Make Operations Idempotent](../../skills/principle-make-operations-idempotent/SKILL.md) makes retries converge on the same end state.
- [Migrate Callers Then Delete Legacy APIs](../../skills/principle-migrate-callers-then-delete-legacy-apis/SKILL.md) migrates callers and deletes the old API in one wave.
- [Separate Before Serializing Shared State](../../skills/principle-separate-before-serializing-shared-state/SKILL.md) removes the sharing before adding coordination.

The verification principles define what counts as proof:

- [Prove It Works](../../skills/principle-prove-it-works/SKILL.md) verifies the real artifact, not a proxy.
- [Fix Root Causes](../../skills/principle-fix-root-causes/SKILL.md) traces each symptom to the cause before changing code.
- [Sequence Work into Verifiable Units](../../skills/principle-sequence-verifiable-units/SKILL.md) ends each small unit in a check before the next starts.
- [Test Behavior, Not Implementation](../../skills/principle-test-behavior-not-implementation/SKILL.md) asserts what the code's users can observe. The test fails when that behavior breaks and survives a change to the internals.
- [Explain the Number](../../skills/principle-explain-the-number/SKILL.md) names what limits a measured number and rules out that it measured something else, before anyone trusts or reports it. [`/skill:benchmark-checklist`](../../skills/benchmark-checklist/SKILL.md) turns it into seven questions that you answer from real runs.

The delegation principles govern parallel work:

- [Guard the Context Window](../../skills/principle-guard-the-context-window/SKILL.md) routes bulk reading to subagent workers and keeps findings in the main session.
- [Never Block on the Human](../../skills/principle-never-block-on-the-human/SKILL.md) proceeds on reversible work and presents the result.

The meta principle:

- [Encode Lessons in Structure](../../skills/principle-encode-lessons-in-structure/SKILL.md) turns advice you have repeated twice into a lint, check, or script. [`/skill:correct`](../../skills/correct/SKILL.md) applies it to a whole repository, as shown in [Make it yours](./09-make-it-yours.md#fix-the-environment-with-skillcorrect).

Next: [Make it yours](./09-make-it-yours.md).
