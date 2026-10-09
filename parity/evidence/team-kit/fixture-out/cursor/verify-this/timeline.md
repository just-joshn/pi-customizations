# Timeline

1. Restated claim falsifiably in `claim.md`.
2. Baseline: read `fixture-app/probe.txt` → line `VALUE=7` (bytes `VALUE=7\n`); copied to `baseline/probe.txt`.
3. Treatment: same file, no edits; copied to `treatment/probe.txt`.
4. Diff: `diff -u baseline/probe.txt treatment/probe.txt` exit 0; `rg -x 'VALUE=7'` match at line 1.
5. Verdict: VERIFIED.
