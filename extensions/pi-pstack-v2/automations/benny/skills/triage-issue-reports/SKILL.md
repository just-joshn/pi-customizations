---
name: triage-issue-reports
description: Dormant Benny triage workflow for new top-level issue reports. Classifies, deduplicates, optionally files a tracker issue with compensation on failed handoff, and posts exactly one thread-only verdict with a single marker. Not a registered slash skill.
---

# Benny triage (`benny-triage`)

Triggered on a new **top-level** source report.

## Steps

1. **Freeze immutable source root coordinates.** Capture the source channel and root thread coordinates immediately. If invalid or missing, fail closed with zero posts.
2. **Read report and attachments.** Inspect the report text, linked media/attachments, relevant source code, and recent history.
3. **Classify.** Assign exactly one classification: `bug`, `performance`, `feature`, `question`, or `reroute`.
4. **Optional routing map.** If a routing map is configured and matches a confirmed area, include the routed owner/area.
5. **Tracker deduplication.** Search the configured issue tracker for the same report or a likely duplicate.
6. **Tracker issue creation.** Create a self-contained tracker issue **only** when the report is a new, live, clear `bug` or `performance` issue with no plausible existing match. Never invent a tracker ID, and never file tickets for features or questions.
7. **Post exactly one thread-only verdict and marker.** Post under the original source root thread with exactly one marker: `[benny:bug]`, `[benny:performance]`, or `[benny:other]`, plus the tracker URL when created. Never post at channel root.
8. **Verify handoff.** Re-read the thread to confirm the verdict landed under the original root:
   - **Verified under root.** Hold one configured follow-up window (answer only direct triage identity questions; stop on request; no side chatter; never emit a second marker).
   - **Failed handoff.** Never retry at channel root. If a tracker issue was newly created in step 6, cancel/close/delete it to compensate and verify the compensation succeeded, then fail closed.

Use `/skill:why` to trace regression history and `/skill:unslop` for the single concise sourced verdict.
