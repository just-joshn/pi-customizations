---
name: setup-pstack
description: Configure which models pstack uses per role and at what reasoning budget. Detects your available models and writes `~/.pi/agent/pstack/models.json`, which overrides the skill defaults. Use for /setup-pstack, "configure pstack models", "pstack budget", or changing pstack's model choices.
---

# Setup pstack

Write `~/.pi/agent/pstack/models.json`, the model configuration every pstack skill reads to set its model per role.

## Steps

### 1. Detect available models

Enumerate the models you can pass to a `pstack_worker` spawn in this session with `pi --list-models`. That is the dependable source. It prints each model's provider, model id, context window, maximum output, whether it supports thinking (`yes` or `no`), and whether it takes images. It lists no thinking levels per model. A model spec is `<provider>/<id>`, with an optional `:<level>` on Pi's ladder (`off`, `minimal`, `low`, `medium`, `high`, `xhigh`, `max`). Pi clamps a level the model does not support down to the highest level it supports. If you cannot detect any, ask the user to paste the slugs they have access to. Never write a real slug you have not confirmed is available. The aliases `inherit-parent` and `auto` are always valid even though they are not detected slugs.

### 2. Load current state

The default role-to-model mapping is the rule shape shown in step 5 below. If `~/.pi/agent/pstack/models.json` already exists, read it and treat its `budget` and its `roles` values as the current choices. pi-pstack reads only `models.json`. A `~/.pi/agent/pstack/pstack-models.md` that an earlier pstack host wrote is never read, so while `models.json` is missing, treat the role lines of that Markdown file as the current choices, and step 5 writes `models.json` from them. Otherwise start from those defaults. A line whose role is not in step 5, such as `how critics`, is from a retired role. Drop it.

### 3. Budget, map, and confirm

**(a) Ask for a budget.** Prefer a multiple-choice question in the conversation over free text. Offer these four options with these exact labels, and name the current budget when the rule records one. With no rule, say that `large` matches the skill defaults.

- `unlimited — max reasoning`
- `large — xhigh reasoning`
- `medium — high reasoning`
- `small — medium reasoning`

**(b) Apply it.** Build the working table from the skill defaults, and on a re-run keep any role you changed by family, list, or alias (`inherit-parent`, `auto`). `unlimited`, `large`, `medium`, and `small` set the thinking level of every real model spec, panel entries included, to `max`, `xhigh`, `high`, or `medium`. The level is the `:<level>` suffix, on Pi's ladder (`off`, `minimal`, `low`, `medium`, `high`, `xhigh`, `max`). Write the target level even when the model may not support it, because `pi --list-models` lists no levels per model and Pi clamps an unsupported level down to the highest one the model supports. A model whose `thinking` column reads `no` takes `:off` under every budget. `inherit-parent` and `auto` do not change. So `unlimited` turns `<provider>/claude-opus-5-5:xhigh` into `<provider>/claude-opus-5-5:max`, and a model whose highest level is `xhigh` runs at `xhigh`. `large` keeps both defaults. `small` sets both to `:medium`.

**(c) Show the roles and confirm.** Show every role with its model, marking as needing a choice any real spec whose `<provider>/<id>` is not in the detected set or whose `:<level>` is not on Pi's ladder. Also list each line step 2 dropped. Ask whether to accept as-is or change specific roles, offering the detected models plus `inherit-parent` and `auto` (both mean: this role runs on the parent chat model, which is how Auto users stay on Auto) as the options. Prefer a multiple-choice question in the conversation over free text. For panel roles (arena runners, architect runners, interrogate reviewers) the value is a list, and one subagent runs per entry, alias entries included, so the list length sets the count. `arena cross-judge pool` is also a list, but Arena runs one judge. It tries only values from a family other than the parent's, in list order, so order it by preference. An `inherit-parent` or `auto` value never judges. `swarm workers` is the default model for every worker unless a race or comparison assigns another model per arm.

### 4. Validate

Every real spec written must have its `<provider>/<id>` in the detected set, and its `:<level>`, when present, on Pi's ladder (`off`, `minimal`, `low`, `medium`, `high`, `xhigh`, `max`). Do not reject a level because the model may not support it, since Pi clamps it. `inherit-parent` and `auto` always pass. If a chosen real spec fails either check, stop and ask again.

### 5. Write the rule

Write `~/.pi/agent/pstack/models.json` with `schemaVersion: 1`, `budget` set to the chosen label, `budgetLine` naming the label and its target effort, and one `roles` key per role, using the same labels poteto-mode uses. Panel roles take a list. Overwrite the whole file atomically, through a temporary file and a rename, so re-runs stay idempotent. Shape:

```
{
  "schemaVersion": 1,
  "budget": "large",
  "budgetLine": "large (xhigh)",
  "roles": {
    "feature, refactoring": "<provider>/grok-4.7-fast:xhigh",
    "bug-fix": "<provider>/grok-4.7-fast:xhigh",
    "perf-issue": "<provider>/grok-4.7-fast:xhigh",
    "hillclimb": "<provider>/grok-4.7-fast:xhigh",
    "judgment and prose": "<provider>/claude-opus-5-5:xhigh",
    "hardest tasks": "<provider>/claude-opus-5-5:xhigh",
    "how explorer": "<provider>/grok-4.7-fast:xhigh",
    "how explainer": "<provider>/claude-opus-5-5:xhigh",
    "why investigators": "<provider>/grok-4.7-fast:xhigh",
    "why synthesizer": "<provider>/claude-opus-5-5:xhigh",
    "reflect tooling": "<provider>/grok-4.7-fast:xhigh",
    "reflect judgment, divergent, synthesizer": "<provider>/claude-opus-5-5:xhigh",
    "arena runners": ["<provider>/claude-opus-5-5:xhigh", "<provider>/grok-4.7-fast:xhigh"],
    "arena cross-judge pool": ["<provider>/claude-opus-5-5:xhigh", "<provider>/grok-4.7-fast:xhigh"],
    "swarm workers": "<provider>/grok-4.7-fast:xhigh",
    "architect runners": ["<provider>/claude-opus-5-5:xhigh", "<provider>/grok-4.7-fast:xhigh"],
    "interrogate reviewers": ["<provider>/claude-opus-5-5:xhigh", "<provider>/grok-4.7-fast:xhigh"]
  }
}
```

### 6. Confirm

Tell the user the file was written and that it applies to every later `pstack_worker` spawn. Say that `models.json` is the only model file pi-pstack reads, and that a `pstack-models.md` beside it has no effect. Re-running this skill updates it.

### 7. Offer a verification skill (optional)

Check whether the project has a way to drive the real app for proof (a `verify-*` skill, or an existing harness). If not, offer once: "want a project-local verification skill, so agents can drive the app the way a user does and prove changes work? I can generate one with /create-verification-skill." On yes, invoke `/create-verification-skill` (resolves wherever pstack is installed: workspace, user, or plugin). On no, move on without pushing.

### 8. Offer a formal verification skill (optional)

Check whether the project already has a formal verification skill (a project skill that runs a model checker, a proof, or another verifier against the code). If not, offer once: "want a formal verification skill, so agents can prove a key property of your code holds in every case in scope, not only the cases tests reach? I can generate one with /create-formal-verification-skill." On yes, invoke `/create-formal-verification-skill` (resolves wherever pstack is installed: workspace, user, or plugin). On no, move on without pushing.
