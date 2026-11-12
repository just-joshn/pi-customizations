---
name: triage-issue-reports
description: Triage Slack issue reports with one thread-only verdict, evidence review, cause-aware routing, tracker dedupe, and fail-closed ticket creation. Use only from the configured Benny triage automation.
disable-model-invocation: true
---

# Triage issue reports

Classify one Slack report and post one useful verdict in its source thread. Create a tracker issue only for a clear, new bug. Do not reproduce or fix it here.

Load the external Benny configuration supplied by the automation. If the config is missing, malformed, or incomplete, stop without posting or writing to the tracker.

## Hard safety rules

- The source channel and root thread coordinates are immutable.
- Never post a root message in the source channel.
- Never post to another channel, broadcast a reply, send a DM, or start a replacement thread.
- Preflight the source parent before any tracker write and immediately before the verdict post.
- If the parent is missing, deleted, inaccessible, or uncertain, stop with no writes.
- Post one substantive verdict. Do not narrate progress.
- The pi-pstack parent process is the only Slack poster and the only tracker writer. You are a worker. You return findings, one verdict, and at most one tracker request. You are read-only and hold no Slack credentials or write actions.
- Every prompt you give a helper must forbid `SendSlackMessage`, `PostToSlack`, `chat.postMessage`, and every other Slack write.
- If you cannot enforce those limits on a helper, do the work yourself.
- Never create an issue that cannot link back to the source thread.
- Prefer no ticket over a guessed or duplicate ticket.
- Apply pstack's `principle-separate-before-serializing-shared-state` to source coordinates.
- Apply pstack's `principle-minimize-reader-load` and `unslop` skills to the final verdict.

## 1. Freeze source coordinates

Before making a work list or delegating:

1. Read `source_channel_id` from the trigger.
2. Require it to equal the configured source channel.
3. Set `SOURCE_THREAD_TS` to `trigger.thread_ts` when present. Otherwise use `trigger.ts`.
4. Require a nonempty `SOURCE_THREAD_TS`.
5. Store `SOURCE_CHANNEL_ID` and `SOURCE_THREAD_TS` as immutable values.
6. The parent verified that the thread root has exactly those coordinates before it started you. It verifies the root again before any tracker write and immediately before the verdict post. You have no Slack tool, so do not look for one.
7. The parent computes the stable source permalink from the coordinates and adds it to every tracker write.

Every later source read and post must use those stored values. Never replace them with a reply timestamp or an operations-thread timestamp.

## 2. Read the whole report

Read the root and the replies your brief carries before deciding. The parent read the thread when it dispatched you.

Capture:

- Reporter wording
- Product version, app build, environment, and platform when present
- Expected behavior
- Observed behavior
- Frequency and trigger
- Error text or stack signature
- Existing issue, commit, or pull request links
- Any explicit statement that someone is already fixing it

Inspect every relevant attachment you can open. Your brief links attachments and you hold no Slack credentials, so a linked file you cannot open is one that cannot be read.

- Read screenshots at full useful resolution.
- Review video for the state transition that separates correct and broken behavior.
- Read logs, traces, and crash text for concrete signatures.
- If media needs specialist review, use a read-only media worker and ask a narrow question. The worker returns findings only.
- If an attachment cannot be read, say so in the verdict. Do not invent what it shows.

Use evidence already in the thread before asking the reporter for more.

## 3. Trace cause before routing

Do a bounded source and history pass before choosing an owner or destination. Use pstack's `how` skill to trace the path from the reported action to the observed result. Use `why` when the report looks like a regression or touches defensive code.

1. Identify the likely code path from the reported action to the observed result.
2. Check whether the visible symptom belongs to that code path or a dependency below it.
3. Check recent changes when the report looks like a regression.
4. Check whether a merged commit or open pull request already addresses the same symptom.
5. Separate confirmed facts from hypotheses.

This pass does not need a complete root cause. It must be strong enough to avoid routing a visible symptom to the wrong owner.

If the repository cannot be read, do not guess a code owner. Continue with a conservative classification and say that cause tracing was unavailable.

## 4. Classify

Choose one category.

### Bug

Something violates intended behavior. Examples include wrong output, broken state, an error, a crash, a hang, a silent no-op, or a regression.

### Performance

The report describes measurable slowness, excess memory, battery drain, jank, or another resource problem. Treat it as a bug, but preserve measurements and profiles.

### Feature request

The current behavior appears intentional and the reporter wants a different behavior or affordance.

### Question or feedback

The report asks how something works, expresses a preference without a concrete defect, or gives general feedback.

### Reroute

Cause tracing shows that another configured destination owns the issue.

When the bug versus feature line is unclear, do not file. The one verdict may ask one focused question and use the `other` marker.

## 5. Apply configured routing

Read the optional routing map from `routing.map_path`.

- Match on confirmed product area, code path, or error signature.
- A visible symptom alone is not enough when cause tracing points elsewhere.
- If no route matches, say the owner is unclear. Do not guess.
- Do not cross-post. Tell the reporter where to take the issue in the source thread.

Owner pings are off by default. A ping is allowed only when all of these hold:

1. The routing map explicitly names the owner.
2. The config allows that ping type.
3. The item is a feature request that needs owner input, or recent history identifies a likely regression author with strong evidence.
4. The owner is not a broad on-call group.

No other case gets a ping.

## 6. Use the issue-tracker adapter

The tracker is an adapter, not a required vendor. A Linear adapter is one valid example. A GitHub Issues adapter or another tracker may implement the same contract.

The parent reaches the tracker through the configured adapter, which must provide:

- Search issues by text, state, label, source URL, and date range
- Read one issue and its links
- Create an issue with title, body, status, labels, and source URL
- Update an existing issue without replacing unrelated fields
- Add a source link and recurrence note
- Cancel, close, or delete an issue created by this run if the Slack handoff fails

If a required operation is unavailable, fail closed for that write.

The adapter resolves configured team, project, status, and labels at runtime. It does not invent IDs, create labels, assign owners, or set priority unless the config explicitly requires it.

You ask for at most one tracker write by adding `tracker` to your final JSON result. Give `operation` (`create`, `update`, or `comment`), `body`, `title` for a create, and `targetId` for an existing issue. It is a request only. The parent checks sections 7 and 8 itself from independent reads before it writes, and it drops a request that fails any of them. Your verdict still posts.

## 7. Dedupe

Always check whether this source permalink is already linked to a tracker issue or a prior triage reply. If so, do not post or create a duplicate.

For bugs and performance reports, search the tracker using:

- Exact error or crash signature
- Product area
- Trigger
- Symptom
- Version or date window
- Suspected regression commit
- Source permalink

Choose one outcome:

- Confident duplicate: same signature, or the same area, trigger, and symptom, or a confirmed shared cause.
- Possibly related: a shared cause is plausible but not proven.
- Weak resemblance: similarity is superficial.
- No match.

For a confident duplicate, request an `update` of the existing issue (`targetId` is that issue) with one short recurrence note. The parent adds the source permalink. Do not reopen, relabel, or reassign it unless the config says to.

For a possible match, link it in the verdict as uncertain and create nothing.

A long-closed issue is a regression lead, not automatically a live duplicate.

## 8. Decide whether to create

Create only when all of these are true:

1. The classification is bug or performance.
2. The behavior is clearly broken.
3. The issue is still live or not known to be fixed.
4. Dedupe found no confident or plausible live match.
5. The source parent and permalink passed preflight.
6. The tracker target fields resolved.
7. The adapter can compensate if the verdict post fails.

Never create for a feature request, question, feedback item, reroute, possible duplicate, confident duplicate, or already-fixed issue.

The new issue must be self-contained:

- Plain title that names the area and symptom
- Reporter quote
- Expected and observed behavior
- Version and environment, or `unknown`
- Trigger and frequency
- Source thread permalink
- Short cause-tracing findings with hypotheses labeled as hypotheses
- Inline screenshot or representative video frame when supported
- Links to remaining artifacts
- Configured intake status and labels

Do not put a guessed root cause in the title.

## 9. Return one verdict

Your final message is one JSON object: `{ "text": "<the verdict>", "tracker": <the optional request from section 6> }`.

The parent runs a fresh source-parent preflight. Then it posts exactly one reply with `channel=SOURCE_CHANNEL_ID` and `thread_ts=SOURCE_THREAD_TS`. It posts nothing when the parent message is missing.

The parent never calls a source-channel posting action without a nonempty `thread_ts`.

Keep the reply short:

- Lead with the outcome.
- Link an existing issue you found in the text. The parent adds the `tracker=<url>` attribute to your marker line itself, for the one issue it wrote or updated, so write the bare marker and no `tracker=` attribute.
- Mention a reroute or one missing fact when needed.
- Include at most one allowed owner ping.
- End with exactly one marker line.

Marker contract. You write the bare marker. The parent appends `tracker=<url>` to your marker line when it wrote or updated an issue, and replaces any `tracker=` you wrote. The repro automation reads that attribute. The posted forms are:

```text
[benny:bug]
[benny:bug] tracker=https://tracker.example/issue/123
[benny:performance]
[benny:performance] tracker=https://tracker.example/issue/123
[benny:other]
```

Use only the configured marker strings. The repro automation trusts the marker only when it comes from the configured triage identity in this source thread.

After posting, the parent reads the same source thread and verifies the verdict appears as a reply under `SOURCE_THREAD_TS`. If it does not, it retries under the same thread with backoff and never at the root.

If this run created a tracker issue and the verdict did not land after the outbox's retry limit, the parent uses the adapter's compensation action and verifies that the issue is canceled, closed, or deleted. If compensation cannot be verified, it reports the failure only in the automation run log.

## 10. Watch one follow-up window

After the verdict posts, the parent watches the source thread for `budgets.triage_follow_up_minutes`, then stops. It starts one follow-up worker for each batch of new human messages. You are that worker when your brief says follow-up, and these rules are yours.

- Answer only a direct question to the triage identity.
- Apply a concrete correction to the tracker issue when safe.
- Do not emit a second marker in the same run.
- Stay out of human coordination and side chatter.
- Stop early if someone asks the automation to stop.

Your final message is one JSON object: `{ "text": "<the reply, or an empty string to say nothing>", "tracker": { "operation": "comment", "body": "<the correction>" }, "stop": true }`. Leave out `tracker` when there is no correction. Add `"stop": true` only when someone asked the automation to stop. The parent posts `text` as a reply in the source thread, comments on the one issue this case owns, and drops any reply that carries a verdict marker.

The parent never extends the window. A new report starts a new run.
