GOAL
Capture a linked Cursor+Pi pair for the unpaid half of PSTACK-CMD-BENNY-TRIAGE-THREAD-ONLY-001: with valid Benny config, triage produces one thread-only verdict and does no reproduce-or-fix work inside the triage skill.

SCOPE
May write under `parity/evidence/benny-triage/`, extend `parity/scripts/capture-benny-triage-fail-closed.mjs` (or sibling), and `parity/briefs/reports/u-journey-cmd-benny-triage-valid-report.md`.
Must not edit ledgers.

CONTEXT
- Negative path already paired: `parity/evidence/benny-triage/pair-benny-triage-fail-closed-1.json` (cursor `876cbcf4-ea8d-4276-9e9b-f0ec2a7da379`, pi `5e2be54e-ec04-4238-a2d0-2fd622e87cc0`).
- Prior report: `parity/briefs/reports/u-journey-cmd-benny-triage-report.md`.
- Requirement expectedObservation also needs valid-config one thread-only verdict; coordinator declined overclaim on fail-closed alone.
- Prefer a fixture with complete-enough config for triage to emit a thread-scoped verdict without Slack live posts if possible (mock/stub adapters OK if skill accepts them); do not invent credentials. If live Slack is required, record that as an honest blocker rather than fabricating.
- Standing: `/Users/josh-desktop/.claude/projects/-Users-josh-desktop-src-personal-pi-pstack-parity-again/pstack/orchestrate/pi-pstack-parity/preferences.md`.

ACCEPTANCE
- Pair JSON with both attempt IDs.
- Observations: one thread-only verdict; no reproduce-or-fix inside triage; no root-channel post (or honest fail/mismatch/blocker).
- Report only; no ledger edits.

VERIFY
Real PTY both sides. Re-read screens + done markers.

TIMEBOX
90 minutes.

FORBIDDEN
No ledger edits. No fabricated pairs. No commit.

REPORT
parity/briefs/reports/u-journey-cmd-benny-triage-valid-report.md

STANDING
Obey orch preferences.md.
