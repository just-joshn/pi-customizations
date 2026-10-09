---
name: setup-benny
description: Prepare dormant Benny files and reviewed Pi routine definitions for an explicitly requested Slack triage and reproduction setup. Read this file directly. It is outside public skill discovery.
disable-model-invocation: true
---

# Set up dormant Benny in Pi

Benny has two workflows. `benny-triage` classifies a new Slack report and leaves one thread verdict. `benny-reproduce` waits for that trusted verdict, gathers twice-reproduced UI evidence, and may prepare a bounded draft fix. The preserved operational files own the algorithms.

This adapter replaces Reference project settings with concrete project files and the host `/automate` skill's reviewed Automations editor handoff. It does not authorize setup or activation by its presence. Create or update definitions only when the user explicitly asks. Never send Slack messages during installation. Webhook button routines stay on `/make-bot-ui` and `Routine*` tools; do not reuse them for Slack Benny automations.

## 1. Merge the dormant project pack

Use the target repository already named by the user. Ask only if the target is missing.

Run `node <pi-pstack-package>/scripts/benny-setup.mjs install <target-repository>`. The helper writes `.pi/automations/benny` and the required shared skills under `.pi/skills`. It never starts a process or edits existing differing files. Review every reported conflict and merge manually without discarding local edits. Preserve destination-only files. Stop for ambiguous ownership rather than replacing a user file.

Verify the entire pack, including `FOR_AGENTS.md`, `skills/setup-benny/SKILL.md`, both operational files, their references, and the templates. Keep the managed pack outside every public skill root and package skill manifest. Do not copy its operational `SKILL.md` files into `.pi/skills`.

The copied setup file is authoritative after installation. Load it directly at `.pi/automations/benny/skills/setup-benny/SKILL.md`.

The project dependencies are `how`, `why`, `tdd`, `unslop`, `principle-separate-before-serializing-shared-state`, `principle-minimize-reader-load`, `principle-guard-the-context-window`, `principle-sequence-verifiable-units`, `principle-fix-root-causes`, and `principle-prove-it-works`. Start a fresh Pi process in the target with an empty agent home. Verify that all ten resolve from `.pi/skills`. A skill loaded from this conversation or a user installation does not count. Verify that the project's pinned pi-pstack extension supplies the native tools the workflows use. A missing project package or tool keeps setup incomplete.

The helper merges a `packages` entry for pi-pstack into `.pi/settings.json`, creating the file when it is absent. It preserves comments, unrelated settings, and every other package entry, and leaves an existing entry unchanged. By default the entry is this package's checkout path. Pass `--package-source=<approved pi package source>` when the project must load pi-pstack from another source. Do not invent a published package version or a cache path to satisfy project installation. Use the actual approved package source and project configuration. Installation does not commit files.

## 2. Fill user-owned configuration

Copy `templates/configuration.example.yaml`, the feature-map example, and the optional routing-map example outside the managed pack. `.pi/benny` is the normal project location. Keep secrets in the configured secret manager or coordinator-only environment. Never include a token in committed YAML, prompts, routine definitions, screenshots, or logs.

Ask for or confirm all thirteen choices:

1. Source Slack channel ID
2. Optional operations or status channel ID
3. Repository URL and default branch
4. Triage identity or Slack user ID
5. Issue tracker type, team, project, labels, and intake status
6. Tracker adapter actions
7. Optional routing map path
8. Required control skill name
9. Required user-facing feature-map path
10. Status emoji strings
11. Pull request URL format
12. Polling and effort budgets
13. Provider/model identity for triage, repro, code work, and media review

Use only provider/model identities shown in Pi's available model registry. Do not guess a slug and do not carry over a private default. The source channel, triage identity, repository, tracker adapter, control skill, and feature map must be explicit. Stop if a required value remains a placeholder or uncertain.

Keep the feature map about user paths and visible states. Do not replace it with current implementation details. Keep owner pings off unless the routing map and configuration explicitly permit a feature owner or strongly evidenced regression author. Never guess an owner or broad on-call destination.

Use the configured budgets. The source example uses 45-second verdict polling, a 45-minute verdict wait, a 10-minute triage follow-up, a 30-minute total triage budget, a 60-minute repro budget, a 10-minute rejection window, a 90-minute fix budget, and a 45-minute operations follow-up. Record any deliberate changes before approval.

## 3. Verify each external capability

Name the actual configured actions for Slack thread reads and replies, attachment downloads, tracker search/read/create/update, tracker compensation, repository history, and draft pull requests. An optional operations channel also needs its configured post/edit actions. Do not use undocumented service endpoints.

A webhook envelope is not proof of a Slack author or thread. The configured trigger adapter must validate its provider's event authenticity, select a new top-level report in the configured channel, preserve the original timestamps, and send the authenticated native webhook. Every run then fetches the actual root and replies through the configured Slack integration. It must not trust a marker, user identity, or ownership claim copied into webhook JSON.

No configured trigger adapter means both workflows remain disabled. Missing tracker compensation means no new issue creation. Missing Slack reply capability means no source update. Report each missing capability explicitly.

Only the coordinator receives Slack credentials and posting actions. Before delegating, prove from the actual worker that it cannot read coordinator credentials or invoke any Slack write action. A prompt prohibition alone is insufficient. Until isolation is demonstrated, keep all work in the coordinator. Analysis workers are read-only. A code worker may edit only during the qualified fix phase and only with the same proven credential and tool isolation.

## 4. Verify the control adapter

Read `skills/reproduce-and-fix-issues/references/control-adapter.md` and the completed feature map. Require all seven capabilities. The adapter must bring up the app, drive real UI actions, exercise mapped features and states, inspect state without mutation, capture screenshots, record the full path, and clean up its processes and fixtures.

Run the source's harmless nine-step check. Start the app, confirm its stable identity, load a completed feature section, navigate its real user path, exercise one disposable state, inspect the state, capture a screenshot, record a clip, and clean up. Missing capability keeps repro disabled. Do not substitute a unit test or injected state for UI evidence.

## 5. Prove the runtime files are committed

The pack, all project dependencies, project package configuration, and every referenced secret-free configuration or map must be committed on the branch used by the automation checkout. Ask the user to commit if that work is outside the current authorization.

Run `node <pi-pstack-package>/scripts/benny-setup.mjs check-committed <target-repository> <configuration-path> <feature-map-path> [routing-map-path]`. Also verify the project's actual package configuration and every runtime reference against that same commit. Re-run the check after edits. Dirty, missing, untracked, or external paths block activation.

Live prompts read the exact committed `.pi/automations/benny/skills/triage-issue-reports/SKILL.md` or `.pi/automations/benny/skills/reproduce-and-fix-issues/SKILL.md`. Each run verifies that its checkout and runtime files match the reviewed commit before external writes. Use repository-relative paths only. Never insert a plugin cache path or copied operational excerpts.

## 6. Prepare sequential reviewed definitions

Distinguish first-time creation from an existing deployment. Inspect existing automation drafts first and never create duplicate active workflows. A changed definition is a new disabled revision. Review the old and new definitions, preserve prior thread-safety receipts only for the matching revision, and keep the old workflow disabled before replacement activation.

Run the `unslop` skill on the final automation names, descriptions, and prompt shims before calling `AutomationPrepare`. Each new draft gets that pass.

### First-time creation

Create one automation at a time. Finish the triage editor handoff before starting repro.

Read `FOR_AGENTS.md` from the copied pack as the primary user-intent source. Read the matching native prompt template as secondary intent. Include the validated source channel, repository, branch, verified runtime commit, configuration, integration actions, models, and budgets.

Read and follow the host `/automate` skill. Tell each live prompt to read and follow its exact committed operational file under `.pi/automations/benny/`. Use repository-relative paths only. Do not copy operational file contents into the live prompt.

Let `/automate` confirm the pack and referenced configuration files are committed, show its draft table, obtain approval, ask readiness, and open the Automations editor (`AutomationOpenEditor`). Editor Save persists a disabled draft only. Do not invent an editor URL, protocol deep link, or Cursor Automations backend call. Do not finish Slack Benny through webhook `Routine*` tools.

Give `/automate` this complete triage intent, filled from configuration:

- Name `benny-triage`.
- Read and follow `.pi/automations/benny/skills/triage-issue-reports/SKILL.md` for every run.
- Trigger on each new top-level report in the configured source Slack channel (`trigger.type = slack.top_level`).
- Read the triggering thread and reply only inside it.
- Use the configured issue-tracker integration.
- Classify, inspect evidence, trace cause, dedupe, and create only clear new bugs.
- End one thread-only verdict with the configured marker and optional tracker URL.
- Never post a source-channel root message.

After that triage handoff is complete, repeat for `benny-reproduce`. Its prompt requires the trusted marker from an actual Slack read, the completed control map, twice-reproduced evidence, ownership checks, existing-fix verification, rejection window, bounded fix, draft-only PR, and cleanup.

### Existing automations

The host `/automate` skill is creation-only. Do not use it to search for, inspect, or update existing automations. Ask the user to update each existing automation directly in its Automations editor. Do not create replacements or duplicates.

### Creation boundary

Never call a direct automation backend service or backend automation tool. Never use a browser URL that carries draft fields. Never build or open a Reference protocol deep link. For new automations, the only finish path is the host `/automate` skill's reviewed Automations editor handoff.

Do not enable either automation until the thread-safety test passes after the editor save. After the seven checks pass for an exact revision, call `AutomationRecordThreadSafety` for that revision, then `AutomationEnable` for the same revision (interactive confirm). Enable marks the draft enabled locally and does not start Slack ingress. Do not route normal traffic until every required check passes and the user authorizes activation.

## 7. Test all seven thread safeguards

Use the configured test channel or an explicitly authorized harmless report. Confirm the frozen runtime commit and both exact operational paths before the test.

1. Triage stores the original root `thread_ts` and posts exactly one substantive verdict as a reply.
2. The verdict contains exactly one configured marker.
3. Repro accepts the marker only from the configured triage identity as an actual reply in that exact thread.
4. Repro retains the same immutable source channel and root timestamp through the entire run.
5. No source-channel root, replacement thread, broadcast, cross-post, or DM is produced.
6. A real delegated worker cannot read Slack credentials or use any Slack write action. If no isolated worker is available, disable delegation and verify coordinator-only execution.
7. Missing coordinates, a deleted parent, or a failed fresh parent preflight produces no source post and no new tracker issue.

The adapter helpers in `scripts/benny-runtime.mjs` and `src/benny-domain.ts` supply frozen-coordinate, marker, bounded-fix, and thread-handoff guards for a configured integration. Use them in the trigger/coordinator bridge. Their fixture tests do not prove a live Slack deployment. `deliverVerdict` preflights before tracker creation and before the sole thread reply, verifies the reply, and compensates only the issue created by that run if handoff fails. Verify the compensation result. Report an unverified compensation only in run output. Never retry at the source root.

## 8. Preserve the operational gates

Read both committed operational files in full. Triage inspects attachments, traces cause before routing, searches tracker duplicates, and prefers no issue over a guessed issue. It posts one marker and permits at most one bounded follow-up window.

Repro stops for human fix ownership. Utility bots supply evidence and do not own fixes unless a person delegated implementation. A concrete existing PR or commit switches to verification. Baseline and patched builds each require the same real UI path twice, a recording, a screenshot, and the same read-only state cross-check. An inconclusive baseline is not a verified fix.

A new fix requires a twice-confirmed repro, independent media approval, no existing artifact or human owner, a closed rejection window, runtime root-cause evidence, sufficient fix budget, and a control adapter for both builds. Use TDD when the local target is cheap. Stop when the scope or budget grows beyond the reviewed bounds. Run focused tests and smoke affected nearby behavior after the patched UI proof.

Only the coordinator reviews the final diff, creates allowed commits, and opens a draft PR. Keep media and tokens out of source control. Never merge or deploy. Success goes to the operations thread, when configured. Never add another unprompted source reply. Follow the source's bounded follow-up and cleanup rules.

Enable normal trigger traffic only after every required check passes and the user authorizes that activation. Keep drafts disabled until then. `AutomationDisable` clears local enabled status without deleting the definition or thread-safety receipt. Crashes and partially delivered external writes require reconciliation before replay.
