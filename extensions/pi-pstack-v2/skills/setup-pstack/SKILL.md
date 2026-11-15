---
name: setup-pstack
description: Configure which models pstack uses per role and at what reasoning budget. Detects your available models and writes ~/.pi/agent/pstack-v2-models.md, which overrides the skill defaults. Use for /skill:setup-pstack, "configure pstack models", "pstack budget", or changing pstack's model choices.
---

# Setup pstack

Write `~/.pi/agent/pstack-v2-models.md`, a file whose role lines the pstack extension shows to the model in every session. It sets pstack's model and thinking level per role.

## Steps

### 1. Detect available models

Run `pi --list-models`. It prints one line per model, with the provider and model columns that make up the `provider/id` you pass to `pi_spawn` and a `thinking` column that says whether the model reasons. That is the dependable source, and `pi_spawn` accepts only models it prints. If the command fails or lists none, ask the user to paste the `provider/id` values they have access to. Never write a real model you have not confirmed is available. The aliases `inherit-parent` and `auto` are always valid even though they are not detected models.

### 2. Load current state

The default role-to-model mapping is the file shape shown in step 5 below. With no file, every role runs on the model this session runs on, so the starting table gives every single role that model. A panel role starts with two entries, which are this session's model and the strongest detected model from another provider, or from another family when only one provider is detected. If `~/.pi/agent/pstack-v2-models.md` already exists, read it and treat its `# budget` line and its role values as the current choices. Otherwise start from those defaults. A line whose role is not in step 5, such as `how critics`, is from a retired role. Drop it.

### 3. Budget, map, and confirm

**(a) Ask for a budget.** Ask in plain text with a numbered list, then end your turn. Offer these four options with these exact labels, and name the current budget when the file records one. With no file, say that `large` matches the skill defaults.

1. `unlimited (max thinking)`
2. `large (xhigh thinking)`
3. `medium (high thinking)`
4. `small (medium thinking)`

**(b) Apply it.** Build the working table from the skill defaults, and on a re-run keep any role you changed by model, list, or alias (`inherit-parent`, `auto`). `unlimited`, `large`, `medium`, and `small` set the thinking level of every real model, panel entries included, to `max`, `xhigh`, `high`, or `medium`. The thinking level is the last token of an entry, on the ladder `max` > `xhigh` > `high` > `medium` > `low` > `minimal` > `off`. Pi clamps a level the model does not support, so keep the target level as it is. A model whose `thinking` column says `no` takes `off`. `inherit-parent` and `auto` do not change. So `unlimited` turns `<provider>/<id> xhigh` into `<provider>/<id> max`, and `small` turns it into `<provider>/<id> medium`. `large` keeps the defaults.

**(c) Show the roles and confirm.** Show every role with its model and thinking level, marking any real model not in the detected set as needing a choice. Also list each line step 2 dropped. Ask whether to accept as-is or change specific roles, offering the detected models plus `inherit-parent` and `auto` (both mean this role runs on the session model) as numbered options. Ask in plain text, then end your turn. For panel roles (arena runners, architect runners, interrogate reviewers) the value is a list, and one spawned Pi runs per entry, alias entries included, so the list length sets the count. `arena cross-judge pool` is also a list, but Arena runs one judge. It tries only values from a family other than the session model's, in list order, so order it by preference. An `inherit-parent` or `auto` value never judges. `swarm workers` is the default model for every worker unless a race or comparison assigns another model per arm.

### 4. Validate

Every real model written must be in the detected set. `inherit-parent` and `auto` always pass. If a chosen real model is not available, stop and ask again.

### 5. Write the file

Write `~/.pi/agent/pstack-v2-models.md` with a `# budget` line holding the chosen budget name and its target thinking level, as in `large (xhigh)`, and one line per role, using the same labels poteto-mode uses. Each line is `<role>[, <role>]: <provider>/<id> <thinking>[, <provider>/<id> <thinking>]`, or `inherit-parent`. Overwrite the whole file so re-runs stay idempotent. Shape:

```
# pstack model configuration. One line per role. Delete a line to fall back to the skill default.
# `inherit-parent` or `auto` as a value: the role runs on the session model (omit pi_spawn `model`). Alias entries in a panel list still count toward its fan-out.
# budget: large (xhigh)
feature, refactoring: <provider>/<id> xhigh
bug-fix: <provider>/<id> xhigh
perf-issue: <provider>/<id> xhigh
hillclimb: <provider>/<id> xhigh
judgment and prose: <provider>/<id> xhigh
hardest tasks: <provider>/<id> xhigh
how explorer: <provider>/<id> xhigh
how explainer: <provider>/<id> xhigh
why investigators: <provider>/<id> xhigh
why synthesizer: <provider>/<id> xhigh
reflect tooling: <provider>/<id> xhigh
reflect judgment, divergent, synthesizer: <provider>/<id> xhigh
arena runners: <provider>/<id> xhigh, <provider>/<id> xhigh
arena cross-judge pool: <provider>/<id> xhigh, <provider>/<id> xhigh
swarm workers: <provider>/<id> xhigh
architect runners: <provider>/<id> xhigh, <provider>/<id> xhigh
interrogate reviewers: <provider>/<id> xhigh, <provider>/<id> xhigh
```

### 6. Confirm

Tell the user the file was written and that pstack reads it at the start of each turn, so it applies from the next message. Re-running this skill updates it.

### 7. Offer a verification skill (optional)

Check whether the project has a way to drive the real app for proof (a `verify-*` skill, or an existing harness). If not, offer once: "want a project-local verification skill, so agents can drive the app the way a user does and prove changes work? I can generate one with /skill:create-verification-skill." On yes, invoke `/skill:create-verification-skill` (resolves wherever pstack is installed: workspace, user, or package). On no, move on without pushing.

### 8. Offer a formal verification skill (optional)

Check whether the project already has a formal verification skill (a project skill that runs a model checker, a proof, or another verifier against the code). If not, offer once: "want a formal verification skill, so agents can prove a key property of your code holds in every case in scope, not only the cases tests reach? I can generate one with /skill:create-formal-verification-skill." On yes, invoke `/skill:create-formal-verification-skill` (resolves wherever pstack is installed: workspace, user, or package). On no, move on without pushing.
