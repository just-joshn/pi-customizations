I've read the full skill (`SKILL.md`, `references/*`, `scripts/rea.mjs`, all of `scripts/lib/**`) and the parity `spec.md`/`decisions.md`/`ledger.json`, and cross-checked claims against the compliance gate (`node scripts/check-agents-compliance.mjs`, which scans `.mjs` under `skills/`). Findings, most important first.

---

**1. `SKILL.md:102-104` — CONFIRMED — the "discipline check" does not exist, and the discipline module is dead code.**
SKILL.md tells the agent to "run the discipline check" with `inspect-analysis-view <evidence_id> --view summary`. That command only re-projects the summary; it performs none of the discipline audit. The real audit (`lib/discipline.mjs:13 auditEvidence`, plus `absenceClaimAllowed`, `unresolvedCitations`, `isWithinTarget`) is referenced by *no* command in `commands.mjs` — only by `tests/discipline.test.mjs`. So the entire DISC-* enforcement surface the docs/spec sell (`spec.md` DISC-001..006) is unreachable from the shipped CLI. Fix: add a `discipline-audit` command that calls `auditEvidence`, or delete the "run the discipline check" sentence and the module.

**2. `scripts/lib/commands.mjs:239` — CONFIRMED — STORE-006's guard is not wired; a directory path yields an untyped failure.**
`inspect-analysis-view` reads a non-`ev_` selector with `JSON.parse(await readFile(resolve(selector)))` directly. The tested guard (`store.mjs:221 readAnyEvidence`, which STORE-006 asserts "refuses a session directory" as `invalid_input`) is never called by the CLI. Passing a directory produces an `EISDIR` → `execution_failure` envelope (verified), not the documented `invalid_input` with an issue path. Fix: use `readAnyEvidence` for the path branch.

**3. `scripts/lib/formats/artifact.mjs:33, ~92` — CONFIRMED — a truncated/unreadable member silently succeeds with `coverage: complete`, and the `fail` integrity policy never fires.**
`readMember` swallows `ZipError` (truncated member, unsupported compression method) into `read_status:'unreadable'`/`crc_ok:null`, which `contradictionsIn` filters out, so `--integrity-policy fail` does not fail. Meanwhile `coverage` is `directory.coverage` = `complete` (only the 2000-member cap sets `partial`). A zip whose member data is truncated or uses Deflate64 is reported as a complete inventory with a silent `unreadable_entries` count. Fix: treat member-level `truncated`/`unsupported_method` as an integrity contradiction under `fail`, and mark coverage `partial` with `omitted_count` when any member is unreadable.

**4. `scripts/lib/formats/har.mjs:61` vs `scripts/lib/views.mjs:120` — CONFIRMED — duplicated api-surface grouping, and the tested copy is not the shipped one.**
`har.mjs apiSurface` reimplements method/origin/path-template grouping (and is what HAR-003 tests), but the CLI's `--view api-surface` path uses `views.mjs apiSurfaceOf`, a separate implementation with different `pathTemplate` logic (`views.mjs:136` regex vs `har.mjs:199` segment split). The shipped path is untested and can drift from the contract. Fix: have `apiSurfaceOf` delegate to `har.apiSurface`, and point the HAR-003 test at the CLI/view path.

**5. `scripts/lib/unknowns.mjs:12, 61` — SUSPECTED — unknown read-modify-write is not serialized by the ledger lock.**
`recordUnknown` (existence check → write) and `updateUnknown` (read → revision check → append) are not under `withLedgerLock`, unlike evidence retention (`store.mjs`). Two sessions in one process sharing a store (the `current.json` pointer makes them share) can lose an unknown revision or double-write. `decisions.md` says "one writer per session is assumed," but STORE-003/CAP-004 only prove the *ledger* is concurrent-safe, not the unknown registry. Fix: wrap unknown writes in the same lock (or a per-file lock).

**6. Dead-code cluster — CONFIRMED — helpers that exist for no (or one test-only) caller.**
`envelope.mjs:75 viewCoverage`, `envelope.mjs:145 graphDigest`, `javascript-nodes.mjs:19 sourceLocation`, `:35 artifactNode`, `:152 isJavaScript`, `:176 timestamp`, `commands.mjs:29 _artifactPath`, `views.mjs:5 _PAGE_DEFAULT`, `capabilities.mjs:147 operationEntry`, and `commands.mjs:4,365 unavailableEntry` (imported and re-exported, never used in the module). All are unused by production code. Fix: delete them.

**7. `scripts/lib/route.mjs:72` — CONFIRMED — `resolveTargetName` has no CLI entry; the documented ambiguity behavior is unreachable.**
SKILL.md ("a name that matches several installed artifacts must be resolved by the user") and ROUTE-002 are only satisfied by `resolveTargetName`/`matchesName`, which no command calls. `route "Notes"` is treated as a *path* and returns a bare `ENOENT` `invalid_input`, never the candidate-list ambiguity error. Fix: add a name-taking command, or drop the claim from the docs/spec.

**8. `scripts/rea.mjs:9, 44` — CONFIRMED — `--overwrite`, `--stable`, `--all` are silently accepted-and-ignored on every command.**
They sit in the global `BOOLEAN_FLAGS` set, so `inspect-binary-layout --overwrite` or `evidence-import --stable` parses cleanly and does nothing — contradicting `decisions.md`'s stated rationale ("unknown flags are rejected rather than ignored"). Fix: move these three out of the global set; declare them only on the commands that use them (`evidence-export`, `capabilities`).

**9. `scripts/lib/commands.mjs` (`inspect-web-network-capture`, ~line 210) — SUSPECTED — non-JSON HAR input yields an untyped failure.**
`JSON.parse(await readFile(...))` runs before `readHarCapture`, so an invalid-JSON capture throws `SyntaxError` → `execution_failure` instead of the documented `unsupported_target`/`malformed` `HarError`. Fix: catch the parse error and map it to a `HarError('malformed', …)` or `unsupportedTarget`.

**10. `scripts/lib/store.mjs` (`importBundle`) — SUSPECTED — bundle unknowns are imported without any integrity check.**
`assertBundleIntegrity` recomputes `evidence_id` for every record but validates nothing about `bundle.unknowns`; a tampered unknown (wrong `unknown_id` vs. question, wrong revision) imports silently. Low severity (UNK-004 only requires round-trip survival), but it's an asymmetry in an evidence tool. Fix: validate `unknown_id === unknownId(question)` before writing.

---

**Categories that are clean:**

- **Immutability of parameters / console.log / nesting / empty catch:** clean. The compliance gate reports only `note`-severity accumulator pushes (output sinks) and no violations. No `console.log` exists anywhere under `scripts/`; output is via `process.stdout.write` in the CLI only.
- **File/function line limits:** no *violations*. Note: `scripts/lib/formats/binary.mjs` is 793 lines — one edit away from the 800-line cap — and `javascript.mjs` is 620. Not a violation, but the binary reader is the natural next split.
- **Pi skill-format robustness:** clean. `tests/skill.test.mjs` parses the frontmatter with Pi's real `parseFrontmatter`, pins the field allowlist and description-length bounds, and SKILL-002 verifies documented commands exist. The only soft spot is `compatibility: "Pi coding agent 1.1.0+ …"` being a free string with no machine check, which is cosmetic.
- **Documented flags generally match accepted flags:** the flag surface documented in `references/*` is declared in `commands.mjs` (the one gap is finding 8, where extra global flags are *over*-accepted rather than under-declared).

Net: the architecture (immutable content-addressed evidence, derived rebuildable ledger, locked ledger writes, no-execution analyzers) is sound; the main problems are (a) a discipline layer that is marketed but not wired, (b) a store guard that is tested but not wired, (c) a ZIP reader that reports `complete` coverage while silently downgrading unreadable members, and (d) a body of dead/duplicated code that inflates the module count and lets the tested and shipped code paths diverge.
