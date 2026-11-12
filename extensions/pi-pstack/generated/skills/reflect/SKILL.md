---
name: reflect
description: Spawn three parallel review subagents over the active transcript, surface learnings, and route each to a concrete edit on an existing skill. Use when the user says reflect.
disable-model-invocation: true
---

# Reflect

Mine the current conversation for durable learnings, then route them into skill edits.

Invoke when the user says "reflect" or "/reflect". Skip when the conversation is trivial, off-topic, or already covered by an existing skill the parent followed correctly. One-offs are not learnings.

## 1. Locate the active transcript

Before fanning out, find this conversation's Pi session file. `$PI_SESSION_FILE` names it, in this workspace's session folder under `~/.pi/agent/sessions/`. Do not glob across `~/.pi/agent/sessions/*/`. That crosses workspace boundaries and reads private chats from unrelated projects.

```bash
ls -t "$(dirname "$PI_SESSION_FILE")"/*.jsonl .pi/pstack/runs/*/workers/*/session/*.jsonl 2>/dev/null | head -10
```

That covers this workspace's sessions and the pstack worker sessions under the project's run root. For each candidate, read its first entry of type `message` whose `message.role` is `user`, because a Pi session file opens with a `system` message. Take the file whose `message.content[0].text` contains the conversation's opening user prompt. If none matches, pass a tight digest of the session instead.

## 2. Spawn three reviewers in parallel

Three `pstack_worker` spawns, one after another without waiting, each with `role: "reviewer"`, `workspace: { mode: "readonly", path: "<absolute repository root>" }`, and `capabilities.mcp: "inherit"`. Reviewers need MCP access to look up the tickets, chat threads, and observability traces the transcript references. A readonly Pi worker keeps its MCP tools, and `capabilities.mcp: "none"` would strip them.

Each reviewer and the synthesizer name a role line in the model rule (`~/.pi/agent/pstack/models.json`) and a default. Set `model` to that line's value, or to the default if the rule or the line is missing. Set `model` to `inherit-parent` when the value is `auto` or `inherit-parent`. If `pstack_worker` spawn rejects a slug, use the default and say so. If it rejects the default, use the closest valid slug of the same family from its error message. Pick each subagent's reasoning level and fast or standard speed for the job, per the Subagents section of the **poteto-mode** skill.

| Lens | Role line | Default `model` | Prompt template |
|---|---|---|---|
| Judgment | `reflect judgment, divergent, synthesizer` | `claude-opus-5-5-xhigh` | `references/judgment-reviewer.md` |
| Tooling | `reflect tooling` | `grok-4.7-xhigh-fast` | `references/tooling-reviewer.md` |
| Divergent | `reflect judgment, divergent, synthesizer` | `claude-opus-5-5-xhigh` | `references/divergent-reviewer.md` |

Pass each template verbatim, substituting the transcript path or digest where marked. Reviewers return findings in their final reply, which `collect` returns.

## 3. Synthesize

One `pstack_worker` spawn, `role: "general"`, `model` from the `reflect judgment, divergent, synthesizer` line (default `claude-opus-5-5-xhigh`), `workspace: { mode: "readonly", path: "<absolute repository root>" }`, `capabilities.mcp: "inherit"`. It spot-verifies citations through MCP, which a readonly Pi worker keeps. Pass `references/synthesizer.md` verbatim, with each reviewer's full output inlined where marked. It returns an Accepted / Rejected / Backlog list.

## 4. Structural enforcement check

Move any Accepted item that a lint rule, script, metadata flag, or runtime check would enforce more reliably to Backlog. See the **encode-lessons-in-structure** principle skill.

## 5. Apply

Present the synthesizer's full Accepted / Rejected / Backlog output and wait for explicit approval before applying any Accepted edit. The user picks the subset and may redirect routings. Skill changes affect every future agent in the org. Do not auto-apply.

File each Backlog item to your team's devex or backlog tracker without waiting. Only the Accepted list waits for approval.

Never edit a skill inside an installed Pi package. Before approval, show its destination, `.pi/skills/<skill>/` or `~/.pi/agent/skills/<skill>/`. After approval, copy the skill folder there and edit the copy. Never open a PR or push.

Follow each approved row's Routing exactly:

- Trivial existing-skill edit (a one-line bullet, a tightened sentence, a stale fact corrected): the parent does it directly.
- Substantive existing-skill edit (a new section, a new pattern table, more than ~10 lines): follow the Authoring a skill playbook (`../poteto-mode/playbooks/authoring-a-skill.md`), including its test cases.
- `tune description: <skill path>` (the skill exists but didn't trigger when it should have): rewrite the skill's `description` per Pi's Agent Skills documentation (`docs/skills.md` in the installed `@earendil-works/pi-coding-agent` package), then check that it triggers on the request it missed.
- `new skill via authoring playbook: <kebab-name>`: create it with the Authoring a skill playbook (`../poteto-mode/playbooks/authoring-a-skill.md`). Do not invent the shape ad hoc.

If your environment ships a SKILL.md validator, run it on every touched skill before declaring done.

## 6. Summarize for the user

Short list, no preamble:

- Edits applied: `<skill path>`. What changed, one line each.
- New skills created: `<skill path>`. One line each (rare).
- Backlog filed to the devex tracker: `<issue title>` (`<tags>`). One line each.
- Dropped: one line per rejected finding + reason from the synthesizer.
