GOAL
Honestly close or keep-open the `npm:commander@14.0.0` / source-lock `externalDependencies[commander].closureAudited=false` gap: independent closure audit of the locked tarball + both consumers, with merge payload for coordinator. Do **not** claim completeDependencyClosure or invent npm registry signatures.

SCOPE
May write `parity/research/dep-commander-closure-001/`, `parity/briefs/reports/u-dep-commander-closure-001-report.md`.
May refresh under `parity/research/npm/commander-14.0.0/` only with new audit artifacts (do not rewrite prior read-inventory hashes).
Must not edit ledgers (coordinator merges). Must not set `completeDependencyClosure` true.

CONTEXT
Prior discovery: `parity/research/npm/commander-14.0.0/read-inventory.json` (14 files read+hashed; consumers orch.ts + watch-pr/cli.ts; `closureAudited:false`; `signatureAuthenticated:false`).
Locked node in `parity/dependencies.json` id `npm:commander@14.0.0` also has `closureAudited:false`.
Tarball integrity already verified in source-lock. Zero third-party runtime deps claimed historically; Bun edge is separate.
Console is locked for desktop units — this unit is offline custody/closure only.
Standing: `/Users/josh-desktop/.claude/projects/-Users-josh-desktop-src-personal-pi-pstack-parity-again/pstack/orchestrate/pi-pstack-parity/preferences.md`.

ACCEPTANCE
- Re-verify tarball sha256 + all 14 file hashes vs reference.
- Re-verify both consumer path hashes.
- Enumerate transitive runtime deps (expect none) with evidence.
- Disposition for `signatureAuthenticated` (authenticate if possible without inventing; else honest blocker).
- Merge payload proposing `closureAudited: true` only if audit is complete; else keep false with remaining blockers listed.
- Explicit: this does not close live-integrations, host CU/enterprise edges, or source-lock `status`.

VERIFY
Hash verify script or shasum list. Report includes inventory sha256.

TIMEBOX
60 minutes.

FORBIDDEN
No ledger edits. No freeze. No fabricated signatures. No further subagents. No desktop Automations/Slack work.

REPORT
parity/briefs/reports/u-dep-commander-closure-001-report.md

STANDING
Obey orch preferences.md.
