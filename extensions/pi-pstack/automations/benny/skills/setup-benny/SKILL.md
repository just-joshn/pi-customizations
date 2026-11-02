---
name: setup-benny
description: Configure Benny and prepare its triage and repro automations. Use when installing Benny or changing its Slack, tracker, repository, routing, control, model, trigger, memory, or budget settings.
disable-model-invocation: true
---

# Set up Benny

Benny ships as a dormant automation pack inside pi-pstack. Pi discovers only pi-pstack's normal skill root; this file and the two operational files are not slash skills.

The human enters setup by pointing Pi at the pack's `FOR_AGENTS.md`. The bootstrap flow copies the whole pack into the target repository, then reads this file directly at `.pi/automations/benny/skills/setup-benny/SKILL.md`.

Benny needs external configuration and two live automations. Each automation is a pi-pstack subscription owned by a long-running Pi session rooted in the target repository:

- Timer mode (default): `subscribe_timer` with a 5-field `cron`. Each fire wakes the owning session, which sweeps the source channel, claims one report, and hands it to one background `Task` on the automation's configured model. The run's result arrives as a Task notification.
- Webhook mode: `subscribe_webhook`. Each POST to the local routine URL wakes the owning session with a `[routine]` turn, and the prompt hands the event to one background `Task` on the automation's configured model.

Creating a subscription auto-starts `pstack-routines-supervisor`. Benny's `wake_self` timers and webhook routines target the owning session. While it is offline, wakes park until that session is restored. Only `new_session` timers can start detached work while the owner is offline. Subscriptions expire after seven days unless renewed. Tell the user this before creating anything. For fires that survive a reboot, ask whether to run `packaging/install-supervisor-unit.sh --workspace <target-repository>` (resolve the script from the pi-pstack package root) and run it when they say yes.

Do not create or update a subscription until the user explicitly asks. Never put a secret value in pack files, prompts, memory, or committed configuration.

## 1. Copy the pack and check shared pi-pstack skills

Do this before asking for Benny configuration and before creating any subscription.

Ask which repository will run the automations. The source pack is the directory containing `FOR_AGENTS.md`. The destination is `<target-repository>/.pi/automations/benny/`.

Merge the entire source pack into the destination:

1. Create the destination when it is absent.
2. Copy every source file to the same relative path.
3. Preserve destination-only files. Never delete unrelated files during install or refresh.
4. Keep user-owned configuration, feature maps, routing maps, and memory outside the destination. Never overwrite them.
5. When an existing source-managed file differs, inspect the diff and merge without discarding local edits. If ownership is ambiguous, stop and ask before replacing it.
6. Verify that the destination contains `FOR_AGENTS.md`, this setup file, both operational files, their references, and the templates.

If this file is already being read from the target destination, treat the copy as complete and run the same verification before continuing.

Confirm that pi-pstack is installed in Pi. A personal install (`pi install <path-to-pi-pstack>`) serves every repository on this machine. A project install (`pi install -l <path-to-pi-pstack>`) writes the target repository's `.pi/settings.json`; preserve every unrelated setting and package entry when that file exists, and validate it after editing.

This setup session must run in the target repository, because a `Task` subagent starts in its parent's working directory. If it does not, stop and tell the user to start Pi in the target repository and point it at `FOR_AGENTS.md` again. Start a fresh `Task` subagent with `readonly: true`. Ask it to resolve `<SKILLS>` from its own system prompt and read each required `<SKILLS>/<name>/SKILL.md` file below. It must report each absolute path and confirm the file's frontmatter names the required skill. Hidden skills need not appear in Pi's automatic skill catalog.

- `how`
- `why`
- `tdd`
- `unslop`
- `principle-separate-before-serializing-shared-state`
- `principle-minimize-reader-load`
- `principle-guard-the-context-window`
- `principle-sequence-verifiable-units`
- `principle-fix-root-causes`
- `principle-prove-it-works`

Do not count a skill this session read by hand or a catalog listing alone. The check must show that a fresh subagent in the target repository receives pi-pstack's host instructions and can read every required installed file.

If pi-pstack or any shared dependency does not resolve, stop and explain the failure.

Confirm that `pi mcp list` shows the Slack MCP server the user names, and that it exposes thread read, thread reply, and, when needed, file download and message edit tools. If it does not, stop and explain what is missing.

The Benny files are read directly from `<target-repository>/.pi/automations/benny/`. Do not move that directory into `.pi/skills/` or expect its `SKILL.md` files to appear in the slash-skill list.

Tell the user to commit `.pi/automations/benny/` and any referenced secret-free configuration, so pack refreshes stay reviewable. Do not commit them unless the user asks.

Once this check passes, subscription prompts read the operational files by their absolute paths in the target checkout. They must not embed a pi-pstack package path or copy the file contents.

## 2. Adapt the configuration

Open these copied examples:

- `../../templates/configuration.example.yaml`
- `../reproduce-and-fix-issues/references/feature-map.example.md`

Create user-owned copies outside `.pi/automations/benny/`. These are configuration files, not pack files. Example locations:

- Project config, such as `.pi/benny/configuration.yaml`
- Project feature map, such as `.pi/benny/feature-map.md`
- Project routing map, such as `.pi/benny/routing.md`
- User config, such as `~/.config/benny/configuration.yaml`
- User feature map, such as `~/.config/benny/feature-map.md`

Fill one feature-map section for every user-facing feature the automation may reproduce. Keep it at the user point of view. Do not freeze implementation details or current code paths in the map.

Do not edit the copied examples. Pack refreshes may update source-managed files after conflict review, but they must never touch the user-owned copies.

Create the memory directory named by `memory.directory`, such as `<pstack dir>/automations/benny/memories/`, where `<pstack dir>` is the directory of the model rule the system prompt names (`~/.pi/agent/pstack` by default), with an empty `ledger.tsv` and a `MEMORIES.md`. Write into `MEMORIES.md` only operating notes a run needs: the target repository path, the configuration path, the subscription names, and, in webhook mode, each routine's URL and credential file path. Never write a key, a token, or report text into memory. Keep the directory out of the repository.

Use absolute paths for the pack, configuration, and memory in subscription prompts. Never reference the pi-pstack package directory from a subscription prompt.

## 3. Fill the required choices

Ask for or confirm:

- Source Slack channel ID
- Optional operations or status channel ID
- Repository URL and default branch
- Absolute path of the target repository checkout
- Triage identity or Slack user ID
- Slack MCP server name and the exact tool for each Slack action
- Issue tracker type, team, project, labels, and intake status
- Tracker adapter skill or MCP actions
- Optional routing map path
- Required control skill name
- Required user-facing feature-map path
- Status emoji strings
- Pull request URL format
- Trigger mode, and the cron schedules for timer mode
- Memory directory
- Polling and effort budgets
- Model for triage, repro, code work, and media review

Use only model specs that `pi --list-models` shows, with a thinking level that model lists, such as `provider/model:high`. Do not guess a model and do not carry over a private default.

The source channel, triage identity, repository, Slack MCP tools, tracker adapter, control skill, and feature map must be explicit. Fail setup if any required value stays ambiguous.

Use pi-pstack's `unslop` skill on the final subscription names and prompts before creating them.

## 4. Check integration capabilities

The triage automation needs:

- Read access to the configured source Slack channel and its threads
- Thread-reply access in that channel
- Attachment metadata and file download access when reports include media
- Search, read, create, and update access through the configured issue-tracker adapter

The repro automation needs:

- Read access to the source thread
- Thread-reply access in the source channel
- Optional post and edit access in the configured operations channel
- Repository read and history access
- `gh` authenticated for the repository, so `gh pr create --draft` can open a draft pull request
- The configured control-adapter skill

Prefer the configured Slack MCP tools for reads and posts. The optional `BENNY_SLACK_BOT_TOKEN` may fill a narrow gap such as editing one operations status message or downloading an attachment. Store the value in a secret manager or the owning session's environment, not in YAML. A writable subagent inherits that environment, which is one reason Benny's workers run readonly.

Do not use undocumented integration endpoints.

## 5. Prepare the routing map

If the user wants reroutes or owner pings:

1. Copy `../triage-issue-reports/references/routing.example.md` outside `.pi/automations/benny/`.
2. Replace every placeholder with public or organization-local values.
3. Keep owner pings off by default.
4. Allow a ping only for a configured feature owner or a confirmed likely regression author.

If no routing map is configured, triage may classify a report but must not guess a destination or owner.

## 6. Verify the control adapter

Read `../reproduce-and-fix-issues/references/control-adapter.md` and the user's completed feature map.

Confirm that the named skill can:

- Bring up the target app
- Navigate every mapped feature through the real UI
- Exercise mapped states through declared adapter actions
- Inspect state without forcing the result
- Capture screenshots
- Start and stop a recording
- Clean up its processes and temporary data

If any capability is missing, do not create the repro subscription. It must fail closed rather than claim a reproduction it did not perform.

## 7. Prepare the live automations

Ask whether this is first-time creation or configuration of existing subscriptions.

Read `../../FOR_AGENTS.md` from the copied pack as the primary user-intent source for either path. Use it to understand the two triggers, tools, instructions, outcomes, and shared rules.

The owning session must be interactive or RPC and rooted in the target repository. A print or JSON run cannot create a subscription. Creating the subscription auto-starts `pstack-routines-supervisor`. Keep the owning session available for prompt handling, or restore it later to drain parked wakes. In both trigger modes, each delivered fire hands its report to one background `Task` with the automation's configured `model`. After both subscriptions exist, ask whether to install the reboot unit with `packaging/install-supervisor-unit.sh --workspace <target-repository>`, and run it only when the user says yes.

### First-time creation

Create one subscription at a time.

For each automation:

1. Read the matching copied prompt template.
2. Fill every `{{...}}` value from the finished configuration. Keep only the trigger block for the chosen mode.
3. Check that the prompt reads its exact operational file under `<target-repository>/.pi/automations/benny/`, by absolute path. Do not copy the operational file contents into the prompt.
4. Show the user the subscription name, mode, schedule, and full prompt, and get approval.
5. Create the subscription:
   - Timer mode: `subscribe_timer` with `name`, `prompt`, and `cron`. Keep the default `sessionStrategy`, `wake_self`, so each fire reaches the owning session, which starts the `Task` on the configured model.
   - Webhook mode: `subscribe_webhook` with `name` and `prompt`. It returns the local URL (`http://127.0.0.1:<port>/routines/<slug>`, where the slug is the kebab-case form of the name) and the credential file path. The key stays in that file. Never print it, paste it into chat, or copy it into the configuration.
6. Run `list_subscriptions`. Confirm the subscription appears with the expected name, schedule or URL, and `expiresAt`. A result of `created: false` means a subscription with that name already exists and kept its old prompt; follow the existing-subscription path instead.
7. Finish the thread-safety checks that apply to this automation before creating the next one.

The triage subscription must:

- Be named `benny-triage`.
- Read and follow `<target-repository>/.pi/automations/benny/skills/triage-issue-reports/SKILL.md` for every run.
- Start on each new top-level report in the configured source Slack channel, one report per run, claimed in the ledger.
- Read the triggering thread and reply only inside it.
- Use the configured issue-tracker integration.
- Classify, inspect evidence, trace cause, dedupe, and create only clear new bugs.
- End one thread-only verdict with the configured `[benny:bug]`, `[benny:performance]`, or `[benny:other]` marker and optional tracker URL.
- Never post a source-channel root message.

After the triage subscription passes its checks, the repro subscription must:

- Be named `benny-reproduce`.
- Read and follow `<target-repository>/.pi/automations/benny/skills/reproduce-and-fix-issues/SKILL.md` for every run.
- Start on the same new top-level reports in the configured source Slack channel, one report per run, claimed in the ledger.
- Use the configured repository and default branch, in a fresh worktree from the default branch.
- Read the source thread and reply only inside it.
- Include draft pull request creation and the configured tracker, control-adapter, and feature-map requirements.
- Wait for a trusted triage marker before acting.
- Reproduce the exact symptom twice through the mapped real UI and capture evidence.
- Verify an existing fix without authoring over it.
- Attempt an optional bounded fix only after confirmed repro, then open a draft pull request when proof and checks pass.
- Never post a source-channel root message.

In webhook mode, Benny ships no relay. Slack cannot reach `127.0.0.1`, so the user runs a Slack app or relay that receives Slack events, verifies them, keeps only new top-level messages in the source channel, and POSTs `{"source_channel_id", "message_ts", "thread_ts"}` as JSON to both routine URLs, with `Authorization: Bearer <key>` read from each credential file. `/routines` lists each routine with its URL, credential file, and status.

### Existing subscriptions

Run `list_subscriptions` to find them. Subscribing again with an existing name does not update it.

Finish configuration, routing, control-adapter, and feature-map validation. Then, for each subscription that must change:

1. Fill the new prompt from the template, as in first-time creation, and get approval.
2. `unsubscribe` the old subscription.
3. Create it again with the same name and the new prompt. A webhook routine keeps its slug, so check whether its URL or credential file changed and tell the user to update the relay.
4. Run `list_subscriptions` and confirm exactly one subscription per name.

To renew an expiring subscription, do the same with the unchanged prompt. Do not create replacements under new names.

### Creation boundary

Create Benny's automations only with pi-pstack's `subscribe_timer` and `subscribe_webhook` tools in the owning session. Do not invent a separate `cron` or `launchd` schedule for Benny. The opt-in `packaging/install-supervisor-unit.sh` install is the reboot path for the durable supervisor, not a Benny schedule. Never expose the routine listener beyond `127.0.0.1` from this setup.

Do not let either automation handle normal traffic until the thread-safety test passes.

## 8. Test thread safety

Create both subscriptions with a test channel as the source channel, or test with a harmless report.

Before testing, confirm that both subscription prompts point at their exact operational files in the target checkout, that the memory directory exists, and that `list_subscriptions` shows both subscriptions. If any check fails, stop. Tell the user that the automation cannot handle traffic yet.

Verify:

1. Triage stores the root `thread_ts` and posts exactly one verdict as a reply.
2. The verdict contains one configured marker.
3. Repro accepts the marker only from the configured triage identity.
4. Repro keeps the same immutable source coordinates.
5. No source-channel root message appears.
6. A delegated worker cannot use any Slack write action: it runs as a `readonly` `Task`, so it has no MCP tools.
7. Missing coordinates, a deleted parent, or a failed preflight produces no post and no tracker issue.
8. A second fire, or a repeated webhook POST, for the same report does no work, because the ledger already lists it.

Handle normal traffic only after all eight checks pass. If the checks ran against a test channel, set the real source channel in the configuration and recreate both subscriptions through the existing-subscription path.
