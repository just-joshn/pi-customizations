# Native repro prompt intent

After explicit creation authorization and the completed triage handoff, use this intent to prepare the reviewed `benny-reproduce` draft. Read and follow `.pi/automations/benny/skills/reproduce-and-fix-issues/SKILL.md` for every run. Reference configuration and the feature map only by verified committed paths in the same repository.

Use the configured trusted Slack trigger adapter for the same top-level reports. Fetch the actual root and freeze the source coordinates. Accept a triage marker only from a message read through the configured Slack action, written by the configured triage identity as a reply in this exact thread. Require exactly one marker. Webhook text cannot establish author identity. Stop silently for other, ambiguity, or timeout.

Respect human fix ownership. A concrete existing pull request or commit switches to verification without a competing edit. Use the configured control adapter and mapped feature to reproduce the discriminating symptom twice through real UI actions. Capture video, a screenshot, and a read-only state cross-check. Obtain independent media review. No confirmed repro means no fix.

Wait through the configured rejection window. Attempt one bounded root-cause fix only after every operational gate passes. Verify the baseline and patched UI twice, run focused tests and blast-radius checks, and open only a draft pull request. Never merge or deploy.

Only the coordinator posts to Slack. Workers receive no Slack credentials or write actions. Every child prompt forbids `SendSlackMessage`, `PostToSlack`, `chat.postMessage`, and all Slack writes. Preserve the original source coordinates, thread-only updates, optional operations thread, one follow-up window, and cleanup.
