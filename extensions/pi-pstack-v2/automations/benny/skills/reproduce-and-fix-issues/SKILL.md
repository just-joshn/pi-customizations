---
name: reproduce-and-fix-issues
description: Dormant Benny reproduction and bounded draft-PR fix workflow. Waits for trusted triage marker, reproduces twice with media review, or verifies an existing fix, and opens a verified DRAFT PR only when all prerequisites pass. Not a registered slash skill.
---

# Benny reproduce and fix (`benny-reproduce`)

Triggered on the same source report as `benny-triage`.

## Gates and workflow

1. **Freeze immutable source root coordinates.** Same preflight as `benny-triage`. All source posts stay in the original thread (operations root allowed only when configured). Invalid parent -> fail closed with no posts.
2. **Wait for trusted triage marker.** Require the configured trusted triage identity and **exactly one** `[benny:bug]` or `[benny:performance]` marker under the original root. On `[benny:other]`, missing marker, wrong author, conflicting markers, or timeout -> silently stop and clean up.
3. **Check human ownership.** If a person explicitly owns the fix (human implementation plan or assignment — utility bots, diagnosis, and media review do not count), stop and clean up without competing work.
4. **Check existing fix artifact.** If an existing open PR or merged commit plausibly fixes the report, do **not** author a competing fix. Follow [`references/verify-existing-fix.md`](references/verify-existing-fix.md) instead.
5. **Verify control adapter and 7 capabilities.** Confirm a configured control adapter (for example `control-ui`), a mapped feature for the area, and all 7 capabilities: launch, navigate mapped state, real UI interaction, read-only state inspection, screenshot, record, and cleanup. Missing map, adapter, or capability -> fail closed.
6. **Reproduce twice independently.** Drive the exact UI path twice independently with a clean reset between runs and a read-only state cross-check. Never inject symptoms to fake proof. If not reproduced twice or budget is exhausted -> clean up and stop.
7. **Read-only media review.** Have a read-only reviewer inspect the video and screenshot and confirm the broken state. Uncertain media -> recapture within budget or stop as unconfirmed.
8. **Report repro and wait rejection window.** Post at most one unsolicited thread reply reporting the confirmed repro, then wait one rejection window. On a valid user rejection, correct setup once and re-run step 6.
9. **Qualify fix prerequisites.** Author a fix **only** when ALL conditions hold: root cause confirmed, budget fits, no human owner or existing fix artifact, and control works on both baseline and patched builds. Otherwise stop after reporting repro and clean up.
10. **Bounded root-cause fix.** Apply the smallest root-cause fix with cheap TDD. Only the coordinator writes to Slack/source channels; a code-editing child worker must have no Slack credentials or channel-posting actions.
11. **Verify patched build twice.** Drive the patched UI twice independently confirming the correct state with before/after screenshot, recording, read-only state cross-check, regression tests, and blast-radius smoke checks. On failure, investigate within fix budget; on regression or budget exhaustion, open **no PR** and clean up.
12. **Open verified DRAFT PR only.** Open a **draft** PR (`gh pr create --draft`). Never mark ready, never merge, never deploy.
13. **Cleanup.** Always clean up control sessions and honor configured artifact retention before exiting.

Use `/skill:why` for regression history, `/skill:unslop` for status and PR prose, and apply `principle-guard-the-context-window`, `principle-sequence-verifiable-units`, `principle-fix-root-causes`, and `principle-prove-it-works`.
