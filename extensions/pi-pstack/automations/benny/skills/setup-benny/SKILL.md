---
name: setup-benny
description: Configure Benny and prepare its triage and repro automations. Use when installing Benny or changing its Slack, tracker, repository, routing, control, model, or budget settings.
disable-model-invocation: true
---

# Set up Benny

Benny ships as a dormant automation pack inside pstack. The pi-pstack package exposes only its normal skill root; this file and the two operational files are not slash skills.

The human enters setup by pointing Pi at the pack's `FOR_AGENTS.md`. The bootstrap flow copies the whole pack into the target repository, then reads this file directly at `.pi/automations/benny/skills/setup-benny/SKILL.md`.

Benny needs external configuration and two automations that pi-pstack runs as event sources.

Do not start or restart an automation until the user explicitly asks. Never put a secret value in package files, prompts, or committed configuration.

## 1. Copy the pack and enable shared pstack skills

Do this before asking for Benny configuration and before starting any automation.

Ask which repository will run the automations. The source pack is the directory containing `FOR_AGENTS.md`. The destination is `<target-repository>/.pi/automations/benny/`.

`node scripts/benny-setup.mjs --project <target-repository>`, run from the pi-pstack package root, does this whole step. It copies the pack and the three user-owned configuration files (`.pi/benny/configuration.yaml`, `.pi/benny/feature-map.md`, `.pi/benny/routing.md`) only where they are absent, merges the settings entry below, creates the webhook secret, and proves the dispatcher on a harmless event. Read its JSON report. A path listed under `conflicts` differs from the pack and was left alone. By hand, the same merge is:

1. Create the destination when it is absent.
2. Copy every source file to the same relative path.
3. Preserve destination-only files. Never delete unrelated files during install or refresh.
4. Keep user-owned configuration, feature maps, and routing maps outside the destination. Never overwrite them.
5. When an existing source-managed file differs, inspect the diff and merge without discarding local edits. If ownership is ambiguous, stop and ask before replacing it.
6. Verify that the destination contains `FOR_AGENTS.md`, this setup file, both operational files, their references, and the templates.

If this file is already being read from the target destination, treat the copy as complete and run the same verification before continuing.

Add pi-pstack to the target repository's `.pi/settings.json` (what `pi install -l npm:@justjoshn/pi-pstack` writes). If the file or `.pi` directory does not exist, create it.

Merge this entry into the existing JSON or JSONC:

```json
{
	"packages": ["npm:@justjoshn/pi-pstack"]
}
```

Preserve every unrelated top-level setting and every other package entry. If `packages` already lists pi-pstack (by npm name, git URL, or path), leave that entry as it is. Preserve comments and valid JSONC syntax when the file uses JSONC. Validate the file after editing it.

Reload the target project or start a fresh agent rooted there. Verify that these shared pstack skills resolve from project scope:

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

Do not count a skill loaded from the current session or a user-scoped install. The check must show that a fresh agent in the target repository receives pstack through project settings.

If project-scoped package installation is unavailable or any shared dependency does not resolve, stop and explain the failure.

The Benny files are read directly from `.pi/automations/benny/`. Do not add that directory to a skill path or a manifest or expect its `SKILL.md` files to appear in the slash-skill list.

Tell the user that `.pi/settings.json`, `.pi/automations/benny/`, and any referenced secret-free configuration must be committed before either automation is enabled. Do not commit them unless the user asks.

Once this check passes, live automation prompts may read the committed operational files by their stable repository-relative paths. They must not embed a pi-pstack package path or copy the file contents.

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

Commit the secret-free copies. The triage worker reads the project directory, but the repro worker runs in a git worktree of the committed revision, so it sees only what is committed. Keep secret values out of them.

Use stable repository-relative paths for committed pack and configuration files. Never reference the pi-pstack package directory from a worker.

## 3. Fill the required choices

Ask for or confirm:

- Source Slack channel ID
- Optional operations or status channel ID
- Repository URL and default branch
- Triage identity or Slack user ID
- Issue tracker. Set `tracker.type: "github"` and `tracker.repo: "owner/name"`. The adapter ships with this package and talks to GitHub through the `gh` CLI. GitHub Issues has no team, project, or status, so those keys are not needed.
- The four tracker labels. They must already exist in the repository, because the adapter applies them and never creates one.
- Optional routing map path
- Required control skill name, which must be a skill pi-pstack ships in `generated/skills`, such as `control-ui` or `control-cli`
- Required user-facing feature-map path
- Status emoji strings
- Pull request URL format
- Polling and effort budgets
- Model slug for triage, repro, code work, and media review

Use only models listed as available in `<pstack_subagents>` or `pi --list-models`. Do not guess a slug and do not carry over a private default.

The source channel, triage identity, repository, tracker adapter, control skill, and feature map must be explicit. Fail setup if any required value stays ambiguous.

Use pstack's `unslop` skill on the final automation names, descriptions, and prompt shims before saving them.

## 4. Check integration capabilities

The pi-pstack process that runs an automation is the only one that talks to Slack and the tracker. It performs every read of the source thread, every post, and every tracker write. Workers return findings and an optional tracker request, and have no tool for any of those writes.

Check, in this order:

1. The Slack connector. `~/.pi/agent/pstack/credentials/slack.json` must hold `{ "token": "xoxb-..." }` with mode 0600. The bot needs `conversations.replies` read access and `chat.postMessage` in the source channel. Without the file, the automation does not start. Never put the token in YAML or in any committed file.
2. The tracker. With `tracker.type: "github"`, run `gh auth status` as the user that will run the automation and confirm `gh api repos/<owner>/<name>` succeeds. The automation treats an unreachable repository as a missing prerequisite and logs each case `blocked` instead of guessing.
3. The webhook secret. `benny-setup.mjs` creates `~/.pi/agent/pstack/credentials/<automation name>.json`. The event sender presents its `key` as `Authorization: Bearer <key>` on `POST /events`.
4. For repro and fix, a draft pull request needs `gh` access to the repository. A worker cannot post or open one itself.

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

The automation checks two things itself before it dispatches a repro case, and logs the case `blocked` when either fails: the feature map at `control.feature_map_path` exists inside the project and is complete, meaning it has at least one feature section with no unfilled `<placeholder>` heading and each feature has `How a user gets there` and `How the control adapter drives it`; and `control.skill_name` names a skill in the package's `generated/skills`. Whether the skill can do the following is judged by the repro worker and by the setup check below, not by code.

Confirm that the named skill can:

- Bring up the target app
- Navigate every mapped feature through the real UI
- Exercise mapped states through declared adapter actions
- Inspect state without forcing the result
- Capture screenshots
- Start and stop a recording
- Clean up its processes and temporary data

If any capability is missing, leave the repro automation disabled. It must fail closed rather than claim a reproduction it did not perform.

## 7. Start the automations

Read `../../FOR_AGENTS.md` from the copied pack as the primary user-intent source. Use it to understand the two triggers, outcomes, and shared rules, and `../../templates/triage-automation-prompt.md` and `../../templates/reproduce-automation-prompt.md` for what each case's worker is told.

There is nothing to draft or paste. When an event arrives, pi-pstack writes the worker's brief itself. The brief names the exact committed operational file, `.pi/automations/benny/skills/triage-issue-reports/SKILL.md` or `.pi/automations/benny/skills/reproduce-and-fix-issues/SKILL.md`, and carries the event as untrusted data.

Start one automation at a time, and only after the user asks:

1. Read the automation names from `.pi/benny/configuration.yaml`: `automations.triage_name` and `automations.reproduce_name`.
2. Run `/pstack automation start <triage name>`. It starts the receiver as a watch worker in tmux on this machine.
3. Run `/pstack automation status <triage name>` and read the receiver URL from it. Point the user's Slack event sender at that URL (`POST /events`, bearer key from step 3 of section 4).
4. Start repro and fix the same way with `/pstack automation start <reproduce name>` once section 6 passes. Repro dispatches a case only when the tracker, the control skill, the feature map, and a trusted triage marker in the source thread all hold.

`/pstack automation stop <name>` ends a source. To apply a changed configuration, stop it and start it again.

To change an automation that already exists, validate the configuration, then stop and start it. Never start a second source for a name that is already running. `start` refuses one that is.

### Start boundary

Never write the event log, the outbox, a cursor, or a credential file by hand. Never run the serve script directly. `/pstack automation start <name>` is the only path, because it records the source as a run the operator can stop.

Do not enable normal traffic until the thread-safety test passes.

## 8. Test thread safety

Use a test channel or a harmless test report.

Before testing, confirm that the target repository's `.pi/settings.json`, `.pi/automations/benny/`, and every referenced secret-free configuration file are committed. Confirm that `/pstack automation status <name>` shows each automation running with a receiver URL. If any check fails, stop. Tell the user that the automation cannot be enabled yet.

Verify:

1. Triage stores the root `thread_ts` and posts exactly one verdict as a reply.
2. The verdict contains one configured marker.
3. Repro accepts the marker only from the configured triage identity.
4. Repro keeps the same immutable source coordinates.
5. No source-channel root message appears.
6. A delegated worker cannot use any Slack write action.
7. Missing coordinates, a deleted parent, or a failed preflight produces no post and no tracker issue.

Enable normal traffic only after all seven checks pass.
