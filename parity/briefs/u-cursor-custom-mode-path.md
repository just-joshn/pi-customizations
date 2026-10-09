GOAL
Find a measured host path that enters Cursor agent Custom Mode for `/poteto-mode` (or prove none exists in cursor-agent PTY), so `PSTACK-MODE-STICKY-001` can get a real reference sticky capture.

SCOPE
May write under `parity/research/cursor-custom-mode-path/`, probes under `parity/evidence/mode-sticky/probes/`, `parity/briefs/reports/u-cursor-custom-mode-path-report.md`.
Must not edit ledgers or product code.

CONTEXT
Pair `parity/evidence/mode-sticky/pair-mode-sticky-1.json` shows Pi sticky works; Cursor Option+Enter sequences failed. Prior probes under `parity/evidence/mode-one-message/probe-*`. Docs mention `\x1b\r` for newlines after terminal setup, not Custom Mode. Search reference pstack README, poteto-help, cursor-agent help/UI strings for "Use as Mode", "Custom Mode", Option+Enter. Try any newly found sequences with real PTY and record screens. Standing orders at orch preferences path.

ACCEPTANCE
- Report names either (a) a sequence/UI path that shows Custom Mode chrome on a real screen, with attempt ID, or (b) exhaustive negative result with sequences tried and doc citations.
- No fabricated Custom Mode.

VERIFY
Re-read any claimed success screen for Custom Mode / mode chrome.

TIMEBOX
60 minutes.

FORBIDDEN
No ledger edits. No commit. No marking MODE-STICKY verified.

REPORT
parity/briefs/reports/u-cursor-custom-mode-path-report.md

STANDING
Obey orch preferences.md.
