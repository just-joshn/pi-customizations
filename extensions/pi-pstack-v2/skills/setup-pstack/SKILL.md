---
name: setup-pstack
description: Configure which models pstack uses per role and at what reasoning budget. Detects your available models and writes pstack-v2-models.md in the Pi agent directory, which overrides the skill defaults. Use for /skill:setup-pstack, "configure pstack models", "pstack budget", or changing pstack's model choices.
---

# Setup pstack

Write `pstack-v2-models.md` in the Pi agent directory (`~/.pi/agent`, or `$PI_CODING_AGENT_DIR` when set), a file whose role lines the pstack extension shows to the model in every session. It sets pstack's model and thinking level per role.

## Steps

### 1. Detect available models

Run `pi --list-models`. It prints one line per model, with the provider and model columns that make up the `provider/id` you pass to `subagent` and a `thinking` column that says whether the model reasons. That is the dependable source, and a worker on a model it does not print fails. If the command fails or lists none, ask the user to paste the `provider/id` values they have access to. Never write a real model you have not confirmed is available. The aliases `inherit-parent` and `auto` are always valid even though they are not detected models.

### 2. Load current state

The default role-to-model mapping is the file shape shown in step 5 below. With no file, every role runs on the model this session runs on, so the starting table gives every single role that model, at the thinking level step 5 shows for that role. A panel role starts with three entries, which are this session's model and the strongest detected models from two other families, at least one of them from another vendor when one is detected. `arena cross-judge pool` starts with two entries from two different vendors, because a second model from a vendor already listed could judge only where the first also could. Families and vendors are the ones Phase A of the **arena** skill defines. If that file already exists, read it and treat its `# budget` line and its role values as the current choices. Otherwise start from those defaults. A line whose role is not in step 5, such as `hardest tasks`, `architect runners`, `reflect tooling`, or `why investigators`, is from a retired role. Drop it.

A file without the `# defaults: 3` line comes from an older setup. That setup wrote a line for every role, so some of its values are old defaults, not choices. Before step 3, replace these values:

- An `arena cross-judge pool` list of three real models with two from one vendor takes the role's step 5 list.
- A `# budget: unlimited` line becomes `large`, because no role runs above `xhigh`.
- If the file has no `# defaults: 2` line either, it wrote every role at `xhigh` and gave every panel two entries. `swarm workers` at `xhigh` takes `high`. In a panel role (`arena runners`, `arena cross-judge pool`, `interrogate reviewers`), a list of exactly two real models, both at `xhigh`, takes the role's step 5 list.

Every other value is the user's choice and stays, including every `inherit-parent` or `auto` value. Tell the user which values you replaced.

### 3. Budget, map, and confirm

**(a) Ask for a budget.** Ask in plain text with a numbered list, then end your turn. Offer these three options with these exact labels, and name the current budget when the file records one. With no file, say that `large` matches the skill defaults.

1. `large (xhigh thinking)`
2. `medium (high thinking)`
3. `small (medium thinking)`

**(b) Apply it.** Build the working table from the skill defaults, and on a re-run keep any role you changed by model, list, or alias (`inherit-parent`, `auto`). Each role has a target thinking level, which is its default's level moved by the budget. `large` keeps it, `medium` lowers it one step, and `small` lowers it two steps, on the ladder `xhigh` > `high` > `medium` > `low` > `minimal` > `off`. No role runs above `xhigh`, and a target at the bottom of the ladder stays there. Most defaults are at `xhigh`, and each budget label names where those land. Set the thinking level of every real model in the role, panel entries included, to the role's target. The thinking level is the last token of an entry. Pi clamps a level the model does not support, so keep the target level as it is. A model whose `thinking` column says `no` takes `off`. `inherit-parent` and `auto` do not change. So `medium` turns `<provider>/<id> xhigh` into `<provider>/<id> high` and `<provider>/<id> high` into `<provider>/<id> medium`, and `small` turns them into `<provider>/<id> medium` and `<provider>/<id> low`.

**(c) Show the roles and confirm.** Show every role with its model and thinking level, marking any real model not in the detected set as needing a choice. Also list each line step 2 dropped. Ask whether to accept as-is or change specific roles, offering the detected models plus `inherit-parent` and `auto` (both mean this role runs on the session model) as numbered options. Ask in plain text, then end your turn. For panel roles (arena runners, interrogate reviewers) the value is a list, and one spawned Pi runs per entry, alias entries included, so the list length sets the count. `arena cross-judge pool` is also a list, but Arena runs one judge. It tries only values from a vendor other than the session model's, in list order, so order it by preference. `claude-fable-*` and the other `claude-*` models are one vendor. An `inherit-parent` or `auto` value never judges. `swarm workers` is the default model for every worker unless a race or comparison assigns another model per arm.

### 4. Validate

Every real model written must be in the detected set and at `xhigh` or below. `inherit-parent` and `auto` always pass. If a chosen real model is not available, stop and ask again.

### 5. Write the file

Write `pstack-v2-models.md` in the Pi agent directory with the `# defaults: 3` line, a `# budget` line holding the chosen budget name and the thinking level that name gives the `xhigh` defaults, as in `large (xhigh)`, and one line per role, using the same labels poteto-mode uses. Each line is `<role>[, <role>]: <provider>/<id> <thinking>[, <provider>/<id> <thinking>]`, or `inherit-parent`. Overwrite the whole file so re-runs stay idempotent. Shape:

```
# pstack model configuration. One line per role. Delete a line to run that role on the session model.
# `inherit-parent` or `auto` as a value: the role runs on the session model (omit subagent `model`). Alias entries in a panel list still count toward its fan-out.
# defaults: 3
# budget: large (xhigh)
feature, refactoring: <provider>/<id> xhigh
bug-fix: <provider>/<id> xhigh
perf-issue: <provider>/<id> xhigh
hillclimb: <provider>/<id> xhigh
judgment and prose: <provider>/<id> xhigh
arena runners: <provider>/<id> high, <provider>/<id> high, <provider>/<id> high
arena cross-judge pool: <provider>/<id> high, <provider>/<id> high
swarm workers: <provider>/<id> high
interrogate reviewers: <provider>/<id> high, <provider>/<id> high, <provider>/<id> high
```

### 6. Confirm

Tell the user the file was written and that pstack reads it at the start of each turn, so it applies from the next message. Re-running this skill updates it.

### 7. Offer a verification skill (optional)

Check whether the project has a way to drive the real app for proof (a `verify-*` skill, or an existing harness). If not, offer once: "want a project-local verification skill, so agents can drive the app the way a user does and prove changes work? I can generate one with /skill:create-verification-skill." On yes, invoke `/skill:create-verification-skill` (resolves wherever pstack is installed: workspace, user, or package). On no, move on without pushing.

### 8. Offer a formal verification skill (optional)

Check whether the project already has a formal verification skill (a project skill that runs a model checker, a proof, or another verifier against the code). If not, offer once: "want a formal verification skill, so agents can prove a key property of your code holds in every case in scope, not only the cases tests reach? I can generate one with /skill:create-formal-verification-skill." On yes, invoke `/skill:create-formal-verification-skill` (resolves wherever pstack is installed: workspace, user, or package). On no, move on without pushing.
