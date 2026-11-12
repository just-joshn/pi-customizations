---
name: reproduce-and-fix-issues
description: Reproduce triaged Slack bugs through a configured app-control adapter, verify existing fixes, and open a bounded draft pull request only after before-and-after proof. Use only from the configured Benny repro automation.
disable-model-invocation: true
---

# Reproduce and fix issues

Wait for a trusted triage marker in the source thread. Reproduce the exact symptom through the target app's real UI. Verify an existing fix when one exists. Attempt a bounded fix only after a confirmed repro.

Load the external Benny configuration supplied by the automation. If the config, required actions, control adapter, or completed feature map is missing, fail closed.

## Hard safety rules

- Freeze the source channel and root thread coordinates before doing any work.
- Never post a root message in the source channel.
- Preflight the source parent before every source-thread post.
- The coordinator is the only Slack poster.
- Delegated analysis workers are read-only and return findings or media notes.
- A fix-phase code worker may edit only when its environment provably excludes Slack credentials and every Slack write action. Otherwise the coordinator edits.
- Every child prompt must explicitly forbid `SendSlackMessage`, `PostToSlack`, `chat.postMessage`, and all other Slack writes.
- Never give a child a Slack token, posting instructions, source coordinates for posting, or permission to report externally.
- If a child needs Slack write access to run, do not launch it.
- Utility bots are evidence sources. They do not own the fix unless a person explicitly delegated the fix to them.
- The exact discriminating symptom must appear twice through real UI interaction.
- State inspection may confirm an observation. It must not inject or force the symptom.
- No confirmed repro means no authored fix.
- Existing pull requests or commits switch the run to verify mode. Do not author over them.
- Use `github.com` pull request links.
- Keep captures, recordings, logs, and tokens out of source control.
- Use pstack's `principle-guard-the-context-window` for delegated analysis.
- Apply pstack's `principle-sequence-verifiable-units`, `principle-fix-root-causes`, and `principle-prove-it-works` through repro, fix, and verification.

## 1. Freeze source coordinates

Before making a work list or delegating:

1. Require the trigger channel to equal the configured source channel.
2. Set `SOURCE_THREAD_TS` to `trigger.thread_ts` when present. Otherwise use `trigger.ts`.
3. Require a nonempty `SOURCE_THREAD_TS`.
4. Store `SOURCE_CHANNEL_ID` and `SOURCE_THREAD_TS` as immutable values.
5. Read the source thread and verify its root has those exact coordinates.
6. Fetch the source permalink.

Never replace these values with a reply timestamp, operations timestamp, or status-message timestamp.

Before every source-channel post:

1. Read the thread by the immutable coordinates.
2. Confirm the parent exists, is not deleted, and still belongs to the source channel.
3. Send only with `channel=SOURCE_CHANNEL_ID` and `thread_ts=SOURCE_THREAD_TS`.
4. Read the thread again and verify the new message is a reply.

If any check fails, post nothing. Never retry at the root or in a fallback channel.

## 2. Wait for the triage contract

The parent watched the source thread for `budgets.verdict_wait_minutes` before it started you, and stayed silent while it waited.

Accept a verdict only when:

- Its author matches `slack.triage_identity_user_id`.
- It is a reply under `SOURCE_THREAD_TS`.
- It contains exactly one configured marker.

Public marker forms:

```text
[benny:bug]
[benny:bug] tracker=https://tracker.example/issue/123
[benny:performance]
[benny:performance] tracker=https://tracker.example/issue/123
[benny:other]
```

The parent applied these checks before it started you. It starts nothing for `other`, a missing verdict, an untrusted author, conflicting markers, or a timeout. Your brief carries the optional tracker URL from the verdict.

This marker replaces private bot identities and free-form verdict matching.

## 3. Apply ownership and fix-artifact gates

Re-read the thread immediately before starting work.

### Someone is explicitly fixing it

Stop when a person clearly claims the fix, gives a concrete implementation plan, or asks another agent to implement, patch, fix, or open a pull request.

Do not treat these as fix ownership:

- A bot summarizes evidence.
- A tool looks up logs or tickets.
- Someone asks a bot to diagnose, explain, inspect, or reproduce.
- A bot posts a cause hypothesis without agreeing to implement it.

Judge the requested action, not the presence of a bot.

### A fix artifact already exists

If an open pull request or merged commit plausibly fixes this report, switch to `references/verify-existing-fix.md`.

An artifact may come from the thread, tracker issue, repository history, or pull request search. A claim without a commit or pull request is not a fix artifact.

If a person owns the work but has not produced an artifact, stop. Do not race them.

## 4. Open an optional operations thread

If `slack.operations_channel_id` is configured, the pi-pstack parent creates one root status message there when it starts your run. This is the only allowed root post in the repro workflow, and it is never in the source channel. You do not post it.

Store its coordinates as `OPERATIONS_CHANNEL_ID` and `OPERATIONS_THREAD_TS`. Never confuse them with the source coordinates.

Use the configured plain Unicode status strings. Keep status text short:

- Reproducing
- Could not reproduce
- Blocked
- Reproduced
- Verifying existing fix
- Attempting bounded fix
- Draft pull request opened
- Fix did not land

You have no Slack tool and never hold a token. Report each status by appending one JSON line, `{ "status": "<one of the statuses above>", "note": "<one short line>" }`, to the `status.jsonl` file your brief names. The parent edits the one status message to match, and it ignores any other status text. Your final result carries the last status and the operations reply, as the brief describes.

If no operations channel is configured, keep detailed status in the automation run output. Do not substitute a source-channel root message.

## 5. Load and check the control adapter

Read `references/control-adapter.md` and the completed map at `control.feature_map_path`, then invoke the skill named by `control.skill_name`.

Find the feature-map section that matches the reported user path. Read it before driving the app. If no section covers the feature, mark the run blocked instead of inventing a path or selector.

Require all seven capabilities:

1. Bring up the configured target app and test environment.
2. Navigate the mapped feature and exercise its documented states.
3. Drive the real UI with clicks, typing, keys, scrolling, drag, resize, or navigation.
4. Inspect state without mutating it.
5. Capture screenshots.
6. Start and stop a screen recording.
7. Clean up processes, sessions, profiles, and temporary data.

If the adapter is absent or any required capability is missing, mark the operations status as blocked and stop. Do not pretend a screenshot, unit test, state mutation, or source reading is a UI repro.

## 6. Study the report

Read the full source thread and tracker issue when present.

Collect:

- Exact action path
- Expected behavior
- Observed behavior
- Discriminating state where they diverge
- Frequency
- Version, environment, and platform
- Attachments and error signatures
- Candidate code area

Inspect screenshots and video. Use read-only parallel workers for code history, test ideas, blast-radius mapping, and media review when useful. Each worker gets a narrow question and the Slack-write prohibition.

Use pstack's `how` skill to trace the action through the repository. Use `why` for regression history and defensive code. Form competing cause hypotheses and identify evidence that would separate them.

## 7. Reproduce

Bring up the target app through the control adapter.

Confirm the correct app, workspace, account, data set, and feature state before acting. Use stable app markers. Do not rely on window order or a familiar title alone.

Drive the reported path through real UI actions.

Before calling it reproduced:

1. Name the correct final state.
2. Name the broken final state.
3. Reach the point where they diverge.
4. Observe the broken state.
5. Reset enough state to make the second attempt independent.
6. Repeat the same path and observe the same broken state again. Record each of the two observations in the proof record your brief describes (`repro.json` in the run's artifact folder): its time, its own capture, and the broken state you saw. The parent accepts `Reproduced` only from that record, and records `Could not reproduce` when it is missing or cannot be checked.
7. Cross-check a real state value when possible.

An expected dialog, loading state, or setup step is not the bug. Capture the final state that distinguishes correct from broken behavior.

Use the configured repro budget. If the symptom does not reproduce within it, report a clean `Could not reproduce` outcome. If the environment cannot provide a required capability, report `Blocked` and state what was missing.

## 8. Capture and review evidence

For a successful repro:

- Record the full path through the symptom.
- Capture a screenshot of the broken final state.
- Save a short note with the exact steps and observed state.
- Keep artifacts in the run's own folder of the configured temporary artifact directory, which your brief names.

Have a read-only media reviewer answer one question: does the evidence visibly show the discriminating broken state?

If the answer is no or uncertain, the repro is not confirmed. Capture better evidence or use `Could not reproduce`.

Put detailed evidence only in the `operations` field of your result. The parent posts it as a reply in the operations thread when one is configured. Keep the source update concise.

## 9. Report the repro outcome

Update the operations status first. The parent applies the `status` of your final result to the operations message before it posts anything in the source thread.

For `Could not reproduce` or `Blocked`, post nothing in the source thread. The operations thread or run output carries the result.

For `Could not reproduce` or `Blocked`, return an empty `text`. For a confirmed repro, the parent runs the source preflight and posts at most one unprompted source reply from your `text`:

- Say the issue reproduced.
- Link the operations evidence thread when one exists.
- Include at most three short findings.
- Link the tracker issue when one exists.
- Do not ping an owner by default.

You cannot attach files and hold no Slack credential. List the evidence files you want attached to the one source reply (the screenshot, the recording, the note) in an `evidence` array of your result. The parent checks each against the retention policy and the run's artifact directory and uploads the ones it may inside the same source thread. Slack takes three files in one message, which limits a message and never what you collect: list every file the repro needs. The parent attaches the first three to the source reply and posts the rest in further messages in the operations thread. When it may not attach one, the file is named in the operations thread and the run log, and the source reply links the operations thread instead, where your `operations` reply carries the evidence.

Stop after this report. The parent holds the configured rejection window (`budgets.rejection_window_minutes`) and reads the source thread, which you cannot. It sends you the new human messages as data, and you decide as follows.

- If a person shows that the setup or interpretation was wrong, correct the repro once and report where it ends.
- If a person claims the fix, gives a concrete implementation plan, or asks you to stop, decide `stop`. The parent then stops you and no fix is attempted.

Do not start the fix phase until the parent sends the go-ahead message, which it sends only when the window closes without a valid rejection.

## 10. Verify an existing fix

When a fix artifact exists, follow `references/verify-existing-fix.md`.

Verification must show the symptom on the baseline and its absence on the patched build. Both paths use the real UI twice.

Do not edit the existing fix, add a competing patch, or open a replacement pull request. Write the verification into the proof record as `existingFix`: the `github.com` link of the pull request or commit, the outcome (`confirmed`, `insufficient`, or `inconclusive`), and the two baseline runs and two patched runs, each with its own timestamped capture. The parent accepts `Verifying existing fix` only with that record. When the verification did not finish, because a half could not be measured or the record does not show it, the parent records `Verification incomplete`, which is neither `Could not reproduce` (a completed reproduction attempt whose evidence cannot be confirmed) nor `Blocked` (the environment prevents the attempt). When the record shows the symptom on both the baseline and the patched build, the claimed fix was verified and does not fix it: the parent shows `Reproduced but not fixed`. After an existing fix the parent starts no fix of this case's own.

## 11. Qualify a bounded fix

Attempt a fix only when all of these hold:

- The outcome is a plain confirmed repro.
- Media review confirmed the broken final state.
- No existing fix artifact appeared.
- No person claimed the fix during the rejection window.
- Runtime evidence identifies the root cause.
- The likely change fits the configured fix budget and repository scope.
- The control adapter can run both baseline and patched builds.

If any condition fails, keep the repro report and stop without a pull request.

When the gate passes, update operations status to `Attempting bounded fix`.

## 12. Root-cause and implement

The coordinator owns every Slack post, the final diff review, commits, and the pull request.

Read-only workers may:

- Trace code and history
- Propose tests
- Map blast radius
- Review a diff
- Review media

They do not edit, run external writes, post status, or own the fix.

A tightly scoped code edit may be delegated during this phase only when tool isolation removes Slack credentials and every Slack write action from that worker. Its prompt must still carry the explicit Slack-write ban. The coordinator reviews the edit and runs or verifies the required tests. If tool isolation is uncertain, keep the edit in the coordinator.

Confirm the mechanism with runtime evidence. Eliminate competing hypotheses before editing.

Fix the root cause with the smallest justified change.

- Invoke pstack's `tdd` skill when there is a cheap local test target, and write the failing test before the fix.
- State why TDD was skipped when the path is expensive, unclear, or integration-heavy.
- Keep unrelated cleanup out.
- Stop if the change grows beyond the configured effort or risk budget.

## 13. Prove the fix

Keep the original baseline evidence.

On the patched build:

1. Run the same real UI path.
2. Repeat it twice.
3. Show that the broken state is gone.
4. Show the expected state in its place.
5. Capture an after recording and screenshot.
6. Cross-check the same real state value used for the baseline.

A compile, unit test, code review, or plausible diff is not after evidence.

Run focused tests, then smoke the blast radius around the changed behavior. Cover nearby states, inputs, permissions, platforms, and failure paths that the change could affect. Stop without a pull request if a regression remains.

## 14. Open a draft pull request

Only after before-and-after proof:

- Review the final diff for unrelated changes and secrets.
- Run the repository's required checks.
- Create small ordered commits when the repository workflow allows it.
- Commit your fix on your run branch in your worktree and describe the pull request in the `pullRequest` field of your result, with a title and a body. Do not push and do not open a pull request, as a draft or otherwise: the parent pushes your branch and opens the draft pull request itself, and it never opens one that is ready for review. The parent opens none until your proof record shows the patched build measured twice (`"fix": { "patched": [...] }`). Never merge or deploy from this workflow.
- Link the configured tracker issue using the tracker's supported pull request syntax.
- Use the configured public URL form, normally `https://github.com/{owner}/{repo}/pull/{number}`.
- Include the repro steps, root cause, test result, before and after evidence, and blast-radius checks.
- Run the pull request text and all Slack updates through pstack's `unslop` skill.

If you cannot produce the commits and the pull request text, do not claim success: report the status `Fix did not land`. If the parent cannot open the pull request, it records `Fix did not land` itself and the commit and branch state stay in your worktree.

The parent records `Draft pull request opened` and posts the linked pull request as one concise reply in the operations thread once the pull request exists as a draft. Do not ask for a second source-channel root or unprompted source reply.

## 15. Follow-ups and cleanup

After the repro lifecycle ends (the report, the rejection window, and the fix phase when there is one), the parent watches the operations thread for `budgets.operations_follow_up_minutes`, then stops. With no operations channel there is no window. It starts one follow-up worker for each batch of new human messages. You are that worker when your brief says follow-up, and these rules are yours.

- Answer a direct question from evidence already gathered.
- Apply one concrete correction and rerun the repro once when it invalidates the setup. You cannot rerun it yourself. Ask for it with `rerun` in your result, and the parent sends the correction to the repro worker as its next message. The parent allows one rerun per case.
- Stay out of human coordination and side chatter.
- Stop when asked.

Your final message is one JSON object: `{ "text": "<the reply, or an empty string to say nothing>", "rerun": { "correction": "<the correction>" }, "stop": true }`. Leave out `rerun` and `stop` when they do not apply. The parent posts `text` as a reply in the operations thread and drops any reply that carries a verdict marker.

When you are the repro worker and the parent sends you a rerun message, rerun the repro once with that correction, report where it ends in the JSON result the message asks for, and do not start the fix phase. The parent never extends the window.

Always call the control adapter's cleanup capability. Keep artifacts only as long as the configured retention policy allows.
