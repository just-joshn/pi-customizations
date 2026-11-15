---
name: reflect
description: Spawn three parallel review workers over the active transcript, surface learnings, and route each to a concrete edit on an existing skill. Use when the user says reflect.
disable-model-invocation: true
---

# Reflect

Mine the current conversation for durable learnings, then route them into skill edits.

Invoke when the user says "reflect" or "/skill:reflect". Skip when the conversation is trivial, off-topic, or already covered by an existing skill the parent followed correctly. One-offs are not learnings.

## 1. Locate the active transcript

Before fanning out, find this conversation's transcript. The `pstack-session` system-prompt section names it. Without that section, look in the Pi session directory for the working directory. By default that is `~/.pi/agent/sessions/--<cwd with the leading slash dropped and each / turned into ->--/`, or under where `sessionDir` or `$PI_CODING_AGENT_SESSION_DIR` points. Do not glob across `~/.pi/agent/sessions/*/`. That crosses workspace boundaries and reads private sessions from unrelated projects.

```bash
ls -t <session-dir>/*.jsonl ~/.pi/agent/pstack-v2/jobs/*/session/*.jsonl 2>/dev/null | head -10
```

That covers this session's files and the sessions of spawned workers, which live under `~/.pi/agent/pstack-v2/jobs/<id>/session/` in the Pi agent directory (`~/.pi/agent`, or `$PI_CODING_AGENT_DIR` when set). Keep only jobs whose `job.json` `cwd` is inside this workspace. For each candidate, read its first user message. Take the file whose first user message contains the conversation's opening user prompt. If none matches, pass a tight digest of the session instead.

## 2. Spawn three reviewers in parallel

One message, three `pi_spawn` calls, each with `readonly: true`. Reviewers keep MCP access in a readonly worker, so they can still look up the tickets, chat threads, and observability traces the transcript references.

Each reviewer and the synthesizer name a role line in the `pstack-models` system-prompt section. Set `model` and `thinking` from that line. Leave `model` unset when the line is missing or its value is `auto` or `inherit-parent`, so the worker runs on the session model. With no lines configured, all three lenses run on the session model. Say so plainly, because the lenses then differ by prompt and not by model. If `pi_spawn` rejects a model, omit `model` and say so. Pick each worker's `thinking` level for the job, per the Spawned Pi workers section of the **poteto-mode** skill.

| Lens | Role line | Prompt template |
|---|---|---|
| Judgment | `reflect judgment, divergent, synthesizer` | `references/judgment-reviewer.md` |
| Tooling | `reflect tooling` | `references/tooling-reviewer.md` |
| Divergent | `reflect judgment, divergent, synthesizer` | `references/divergent-reviewer.md` |

Pass each template verbatim, substituting the transcript path or digest where marked. Each reviewer exits with its findings as its report, and you are woken with it.

## 3. Synthesize

One `pi_spawn` call with `readonly: true`, `model` from the `reflect judgment, divergent, synthesizer` line. It spot-verifies citations through MCP, which a readonly worker keeps. Pass `references/synthesizer.md` verbatim, with each reviewer's full output inlined where marked. It returns an Accepted / Rejected / Backlog list.

## 4. Structural enforcement check

Move any Accepted item that a lint rule, script, metadata flag, or runtime check would enforce more reliably to Backlog. See the **encode-lessons-in-structure** principle skill.

## 5. Apply

Present the synthesizer's full Accepted / Rejected / Backlog output and wait for explicit approval before applying any Accepted edit. The user picks the subset and may redirect routings. Skill changes affect every future agent in the org. Do not auto-apply.

File each Backlog item to your team's devex or backlog tracker without waiting. Only the Accepted list waits for approval.

Never edit a skill inside an installed Pi package. Before approval, show its destination, `.pi/skills/<skill>/` or `<Pi agent directory>/skills/<skill>/`. After approval, copy the skill folder there and edit the copy. Never open a PR or push.

Follow each approved row's Routing exactly:

- Trivial existing-skill edit (a one-line bullet, a tightened sentence, a stale fact corrected): the parent does it directly.
- Substantive existing-skill edit (a new section, a new pattern table, more than ~10 lines): write the `SKILL.md` to Pi's skills spec (the Agent Skills format), check it loads with `/skill:<name>`, and iterate on it.
- `tune description: <skill path>` (the skill exists but didn't trigger when it should have): rewrite its description to Pi's skills spec and check the skill still loads with `/skill:<name>`.
- `new skill: <kebab-name>`: write it to Pi's skills spec and check it loads with `/skill:<name>`. Do not invent the shape ad hoc.

If your environment ships a SKILL.md validator, run it on every touched skill before declaring done.

## 6. Summarize for the user

Short list, no preamble:

- Edits applied: `<skill path>`. What changed, one line each.
- New skills created: `<skill path>`. One line each (rare).
- Backlog filed to the devex tracker: `<issue title>` (`<tags>`). One line each.
- Dropped: one line per rejected finding + reason from the synthesizer.
