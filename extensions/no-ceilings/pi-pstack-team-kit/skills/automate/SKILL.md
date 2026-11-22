---
name: automate
description: Prepare a new Pi automation for review and hand it off to a configured automation editor. Use when the user explicitly asks to create a scheduled or event-triggered Pi automation.
---
# Create Automation (Interactive)

Use this skill only to create a new automation. Do not assume “automate this” means a hosted agent automation. Route CI, scripts, or other named systems to their own workflows. Do not list, inspect, or update existing automations as part of this flow.

## Execution spine (every run)

1. **Finish-path check.** Check the current Pi tool and command catalog for a configured automation editor that can open a draft without saving or enabling it. Pi core and the team kit do not provide that editor. If none is available, stop and tell the user they need to configure one. Do not substitute a goal, a loop, a browser prefill URL, or a scheduler write.
2. **Capture intent + proactive integration discovery.** If the prompt is missing two or more of {what kicks it off, what should happen, what outcome}, send one short plain-chat question and wait. Discover repositories, channels, services, or projects via the configured integrations before asking questions the catalog can answer.
3. **Completeness gates.** Work in this order: trigger, tools, prompt, name and description. Resolve required inputs or confirm the user wants to defer them to the editor. Never defer a field that the editor cannot resolve.
4. **One consolidated question.** Ask inline about unresolved choices. Use `ask_question`, if available, for multi-select tools and integration candidate lists with three or more matches. Do not invent tools, integration IDs, or trigger fields.
5. **Draft table → approval → finish handoff.** Show a compact Markdown table with name, description, trigger, tools, instructions, resolved settings, and “To finish in editor”. Keep the provider payload internal. Ask for approval. Then ask whether the user is ready for you to open the editor. When they say yes, open the approved draft. Do not save, enable, or run it. Repeat the deferred items in the handoff note.

## Completeness and deferral

- Resolve the schedule and timezone. Do not encode a guessed cron expression or leave the schedule only in the prompt.
- For Git triggers, resolve repository and branch or organization scope as required by the provider. For chat and incident triggers, resolve the source independently of any action destination. Offer replying in the triggering thread separately from sending to a specified channel.
- Discover integrations through read-only catalog and picker calls. An integration must be available to the editor, not merely listed in this session. Use the exact identifier the editor advertises. If authentication is required, stop before showing or handing off the draft. Ask the user to connect it, then recheck. Never put tokens in the draft.
- Include repo file paths or contents only when the automation will check out that same repository and the files are committed on the branch it will use. Otherwise paraphrase the intent or ask the user to commit the files first.
- Show the reviewed draft in plain language. Do not expose tool schemas or raw CLI output unless asked. For webhook URLs and credentials generated on save, record the remaining steps in “To finish in editor”. Do not guess their values.
