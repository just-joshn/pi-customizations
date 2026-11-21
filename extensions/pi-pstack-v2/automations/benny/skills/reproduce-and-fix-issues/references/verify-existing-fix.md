# Verify existing fix

Use this path when `benny-reproduce` finds an existing open PR or merged commit that plausibly fixes the triaged report. Never edit the patch and never open a competing PR.

## Procedure

1. Select the baseline revision:
   - For an open PR: use its base branch.
   - For a merged commit: use the pre-fix parent revision.
2. Drive the exact reported UI path **twice independently** on the baseline build (with clean reset and read-only state cross-check) using the same environment and data.
3. Drive the exact same path **twice independently** on the patched build and capture before/after screenshots and recordings.
4. Classify the result:
   - **CONFIRMED:** baseline reproduces the broken state twice AND patched build shows the correct state twice. Post the evidence reply in the source thread.
   - **INSUFFICIENT:** broken on both baseline and patched builds. Report the finding without opening a replacement PR.
   - **INCONCLUSIVE:** baseline missing or patch cannot run. Make no fix claim.
5. Clean up all control sessions and honor configured artifact retention.
