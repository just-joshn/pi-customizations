# pi-pstack behavior parity: findings and plan

This run compares pi-pstack 0.15.36-pi.11 with Cursor's pstack 0.15.36, its `cursor-team-kit` 1.2.0 dependency, and the Cursor host features both rely on. The reference for host behavior is the Cursor CLI 2026.10.22-27dcf5f, read from its installed bundle and driven live with both plugins loaded (`cursor-agent -p --plugin-dir`), plus the Cursor docs pages at cursor.com/docs (skills, subagents, plan mode, CLI). Earlier parity records were not used as evidence.

The raw probe output holds Cursor's own prompt text, so it stays out of git. [`probe-cursor.sh`](probe-cursor.sh) reruns every probe and writes it to `.audit/pi-pstack-behavior-parity/cursor-evidence/<name>.jsonl`; the evidence names below are those files. The custom-mode notices and the plan file format come from the CLI bundle's `custom-modes` and `plan-utils` modules (`~/.local/share/cursor-agent/versions/2026.10.22-27dcf5f/1623.index.js`).

## Definition of done

Each gap below is closed when a run of the real Pi CLI, driven by the package's scripted test model (which reports what the model receives), shows the Cursor behavior named in its row, and the package's typecheck, Vitest suite, and Biome lint pass.

## Gaps found

| ID | Cursor behavior (evidence) | pi-pstack before this run | Fix |
| --- | --- | --- | --- |
| G1 | A Custom Mode keeps the skill in context for the whole session (cursor.com/docs/skills: "keeps the skill in context for the whole session"; `durable_skill_blocks` in the CLI's conversation-state proto). | The body rides one run, then only a reminder remains. Models that collapse system messages (Anthropic) lose the body after the first run. | Keep the skill block in the `pstack_mode` section on every request while the mode is on. |
| G2 | Leaving or switching a mode sends "The user has exited X custom mode. Stop following that mode's skill. Continue without those constraints." once (CLI bundle `custom-modes` module, function `p`). Entry and reminder texts come from the same function. | No exit or switch notice. | Track Cursor's mode lifecycle (entered, active, pending exit) and send its three notices. |
| G3 | A background completion arrives as `<system_notification>` with "If you were already aware, ignore this notification and do not restate prior responses.", `title` = the first 80 characters of the prompt, then a follow-up instruction (`task-resume-and-notification.jsonl`, `task-background-long-prompt.jsonl`). | Different preamble, no wrapper, title = description, no follow-up instruction. | Match the text. |
| G4 | Background Task result: "Subagent is running in the background. When you end your turn, you will be automatically sent the subagent's final response upon its completion, so do not wait for it - either end your turn or work on something else." (`task-background.jsonl`). | Different wording. | Match. |
| G5 | Agent ID line: "(can be used with the `resume` parameter to send a follow-up after it completes)" (`subagent-tools.jsonl`). | "(pass it as `resume` to send a follow-up after it completes)". | Match. |
| G6 | TodoWrite's description tells the model when to use a todo list, the four states, one `in_progress` item at a time, and to batch updates with other calls (`dynamic-tool-schemas.jsonl`). | One sentence. | Carry the same rules. |
| G7 | Task's description tells the model when not to delegate, to run parallel agents in one message, that the child sees nothing of the chat, to trust results, and to wait for background notifications (`task-schema.jsonl`). | Shorter. | Carry the same rules. |
| G8 | Built-in `explore` subagent: a file-search specialist with no Task tool (`context-blocks.jsonl`, `subagent-role-text.jsonl`, cursor.com/docs/subagents). team-kit's thermo-nuclear agent tells the parent to use it. | No `explore` type; the agent text was rewritten to forbid it. | Add `explore`; restore the upstream agent text. |
| G9 | `GenerateImage` tool (`dynamic-tool-schemas.jsonl`); pstack's `teach` and `ketchup` reach for an image tool. | Only codemode's `models.generateImages()`, which is off by default. | Register `GenerateImage` on `ctx.modelRegistry.generateImages()` when an image model is available. |
| G11 | Every subagent is told "You are running as a subagent under a parent agent. Do not spawn additional subagents unless requested by the user or by your instructions." (`subagent-role-text.jsonl`). | No such instruction. | Add it to every child. |
| G12 | A skill with `paths` and `disable-model-invocation: true` never attaches on its own (`ts-skill-attach.jsonl`, `ts-plugin-skill-attach.jsonl`, cursor.com/docs/skills). | `path-skills.ts` attaches `typescript-best-practices` when a `.ts` file is read. | Remove the auto-attach. |
| G14 | A `/loop` tick that comes due during a run wakes the agent once after the run (Cursor's built-in `loop` skill, `~/.cursor/skills-cursor/loop/SKILL.md`: monitored shell output notifies after the turn). | The tick is skipped. | Coalesce it into one fire after the run. |
| G15 | Plan mode leaves through `SwitchMode` with user consent when the user asks to build (plan-mode guardrails, `plan-mode-text.jsonl`). | No tool; only `/plan build` or `/plan off`. | Add `SwitchMode`. |
| G16 | Plan mode: `CreatePlan {plan, name, overview, todos}` writes `<name>-<chat id 8>.plan.md` with a todos front matter; markdown files stay editable; Cursor's plan-mode instructions; a build prompt after the plan (`plan-mode-text.jsonl`, `plan-mode-tools.jsonl`, CLI bundle `plan-utils.ts` and `create-plan-tool-ui.tsx`). | `create_plan {name, content}`, a random id per call, all writes blocked, different instructions, no prompt. | Match the schema, file, instructions, markdown edits, and the build prompt. |
| G25 | n/a (internal consistency) | `make-bot-ui` says routines expire and webhooks cannot use `new_session`; the code says neither. | Fix the text. |

## Not changed, with the reason

- Cloud VMs, Bugbot, Cursor Automations hosting, Grok Bot routines, and the Agents Window UI are Cursor services. pi-pstack keeps its local worktree workers and subscriptions as the Pi mechanism for them.
- Cursor's model allowlist rejects pstack's default slugs (`claude-opus-5-5-xhigh` and `grok-4.7-xhigh-fast` were refused in `task-errors.jsonl`). Pi accepts any model it lists at a level the model supports, so pstack's defaults run as written.
- Cursor CLI subagents and `-p` runs have no `AskQuestion`. pi-pstack returns each question as skipped there, which keeps the same outcome.
