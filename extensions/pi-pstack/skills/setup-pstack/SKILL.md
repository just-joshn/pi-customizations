---
name: setup-pstack
description: Configure which models pstack uses per role and at what reasoning budget. Detects your available models and writes the model rule, which pi-pstack adds to every request and which overrides the skill defaults. Use for /setup-pstack, "configure pstack models", "pstack budget", or changing pstack's model choices.
---

# Setup pstack

Write the model rule that sets pstack's model per role, at the path the system prompt names (`~/.pi/agent/pstack/pstack-models.md` by default). pi-pstack adds it to every request.

## Steps

### 1. Detect available models

Enumerate the model values you can pass to a `Task` subagent in this session. The system prompt's `pstack_subagents` section lists them as Pi model specs, with the thinking levels each model accepts. That is the dependable source. `pi --list-models` lists every model Pi knows; use it for completeness. If you cannot detect any, ask the user to paste the model specs they have access to. Never write a real model spec you have not confirmed is available. The aliases `inherit-parent` and `auto` are always valid even though they are not detected models.

### 2. Load current state

The default role-to-model mapping is the rule shape shown in step 5 below. If the model rule already exists, read it and treat its `# budget` line and its role values as the current choices. Otherwise start from those defaults. A line whose role is not in step 5, such as `how critics`, is from a retired role. Drop it.

### 3. Budget, map, and confirm

**(a) Ask for a budget.** Prefer AskQuestion over free text. Offer these four options with these exact labels, and name the current budget when the rule records one. With no rule, say that `large` matches the skill defaults.

- `unlimited — max reasoning`
- `large — xhigh reasoning`
- `medium — high reasoning`
- `small — medium reasoning`

**(b) Apply it.** Build the working table from the skill defaults, and on a re-run keep any role you changed by family, list, or alias (`inherit-parent`, `auto`). `unlimited`, `large`, `medium`, and `small` set the effort token of every real model spec, panel entries included, to `max`, `xhigh`, `high`, or `medium`. The effort token is the `:<level>` suffix, or `effort=<level>` inside `[...]` (a `fast=true` there is speed, not effort), on the ladder `max` > `xhigh` > `high` > `medium` > `low`. If the result is not a detected model at that level (Task rejects a level the model does not list), use the same family's detected model at the highest effort at or below the target, else mark the role as needing a choice. `inherit-parent` and `auto` do not change. So `unlimited` turns `claude-opus-5-5:xhigh` into `claude-opus-5-5:max`. Grok tops out at `xhigh`, so under `unlimited` the fallback puts Grok at `xhigh` and keeps `grok-4.7:xhigh` as it is. `large` keeps both defaults. `small` turns them into `claude-opus-5-5:medium` and `grok-4.7:medium`.

**(c) Show the roles and confirm.** Show every role with its model, marking any real model spec not in the detected set as needing a choice. Also list each line step 2 dropped. Ask whether to accept as-is or change specific roles, offering the detected models plus `inherit-parent` and `auto` (both mean: this role runs on the parent chat model, which is how a role follows the chat model when the user switches it) as the options. Prefer AskQuestion over free text. For panel roles (arena runners, architect runners, interrogate reviewers) the value is a list, and one subagent runs per entry, alias entries included, so the list length sets the count. `arena cross-judge pool` is also a list, but Arena runs one judge. It tries only values from a family other than the parent's, in list order, so order it by preference. An `inherit-parent` or `auto` value never judges. `swarm workers` is the default model for every worker unless a race or comparison assigns another model per arm.

### 4. Validate

Every real model spec written must be in the detected set, at a thinking level that model lists. `inherit-parent` and `auto` always pass. If a chosen real model spec is not available, stop and ask again.

### 5. Write the rule

Write the model rule at the path the system prompt names, as plain Markdown with no frontmatter: a `# budget` line with the chosen label and its target effort, and one line per role, using the same labels poteto-mode uses. Overwrite the whole file so re-runs stay idempotent. Shape:

```
# pstack model configuration. One line per role. Delete a line to fall back to the skill default.
# `inherit-parent` or `auto` as a value: the role runs on the parent chat model (omit Task `model`). Alias entries in a panel list still count toward its fan-out.
# budget: large (xhigh)
feature, refactoring: grok-4.7:xhigh
bug-fix: grok-4.7:xhigh
perf-issue: grok-4.7:xhigh
hillclimb: grok-4.7:xhigh
judgment and prose: claude-opus-5-5:xhigh
hardest tasks: claude-opus-5-5:xhigh
how explorer: grok-4.7:xhigh
how explainer: claude-opus-5-5:xhigh
why investigators: grok-4.7:xhigh
why synthesizer: claude-opus-5-5:xhigh
reflect tooling: grok-4.7:xhigh
reflect judgment, divergent, synthesizer: claude-opus-5-5:xhigh
arena runners: claude-opus-5-5:xhigh, grok-4.7:xhigh
arena cross-judge pool: claude-opus-5-5:xhigh, grok-4.7:xhigh
swarm workers: grok-4.7:xhigh
architect runners: claude-opus-5-5:xhigh, grok-4.7:xhigh
interrogate reviewers: claude-opus-5-5:xhigh, grok-4.7:xhigh
```

### 6. Confirm

Tell the user the rule was written and that it applies from the next request. Re-running this skill updates it.

### 7. Offer a verification skill (optional)

Check whether the project has a way to drive the real app for proof (a `verify-*` skill, or an existing harness). If not, offer once: "want a project-local verification skill, so agents can drive the app the way a user does and prove changes work? I can generate one with /create-verification-skill." On yes, invoke `/create-verification-skill` (resolves wherever pi-pstack is installed). On no, move on without pushing.

### 8. Offer a formal verification skill (optional)

Check whether the project already has a formal verification skill (a project skill that runs a model checker, a proof, or another verifier against the code). If not, offer once: "want a formal verification skill, so agents can prove a key property of your code holds in every case in scope, not only the cases tests reach? I can generate one with /create-formal-verification-skill." On yes, invoke `/create-formal-verification-skill` (resolves wherever pi-pstack is installed). On no, move on without pushing.
