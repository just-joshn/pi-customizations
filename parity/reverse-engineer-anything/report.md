# Pi-native REA reimplementation — acceptance report

## Implementation summary

`skills/reverse-engineer-anything/` is a self-contained Pi skill that reimplements REA's
investigation contract with no dependency of any kind on REA: no npm package, no MCP server, no
analysis engine, no network, no configuration. The user-visible behavior is:

- **The Evidence contract.** Every analysis returns one envelope with a content-addressed
  `evidence_id`, a subject digest, provider and predicate identity, parameters, normalized result,
  confidence, authority, limitations, locations and evidence links. Observations carry their own
  authority, state, confidence, coverage and limitations.
- **Session memory.** Evidence is written to `<cwd>/.rea` (or `--store`) before it is reported,
  deduplicated by content, indexed by a rebuildable ledger, and exportable/importable as a
  byte-stable bundle whose content addresses are validated on import.
- **Residual unknowns.** A question, its required authority/confidence, recommended probes and
  supporting or contradicting evidence, updated only through revision-checked immutable revisions,
  and resolvable only by evidence that meets its stated requirement.
- **Routing and availability.** Target routing from the leading bytes, name resolution that refuses
  ambiguity, and a capability matrix with the reference's seven effect flags and per-operation
  limitations.
- **Engine-free analyzers.** JavaScript/Electron applications and ASARs, archive/package inventories,
  Mach-O/ELF/PE layout, Go build metadata, and retained HAR captures — all read-only, none executing
  the target.
- **The investigator's discipline, enforced.** `discipline-audit` checks the rules a report must
  satisfy and says which records may support an absence claim.

Pi mechanism: a skill (`SKILL.md` + five references) plus dependency-free Node helpers invoked
through `scripts/rea.mjs`. A skill is the Pi mechanism for on-demand procedural work; the
deterministic parts live in scripts so they cannot drift from prose.

## Artifact map

| File | Responsibility |
| --- | --- |
| `SKILL.md` | Routing, staged workflow, reporting rules; the only always-loaded text besides the description |
| `references/native-and-artifacts.md` | Binaries, Go metadata, archives |
| `references/javascript-applications.md` | JS/Electron graph, node kinds, feature tracing |
| `references/evidence-workflows.md` | Envelope, coverage, views, unknowns, audit, export |
| `references/runtime-observation.md` | The no-execution boundary and how to record a runtime gap |
| `references/connection-and-recovery.md` | Error contract, unavailable families, store recovery |
| `scripts/rea.mjs` | CLI: argument parsing, flag scoping, error envelopes, exit codes |
| `scripts/lib/{canonical,envelope,errors,error-vocabulary,store,store-io,unknowns,views,discipline,capabilities,route,target,commands}.mjs` | Evidence kernel, store, unknowns, views, discipline audit, matrix, routing |
| `scripts/lib/formats/{javascript,javascript-lexer,javascript-graph,javascript-nodes,artifact,asar,zip,binary,gobinary,har,target-source}.mjs` | Format readers and the analyzer |
| `tests/*.test.mjs` (14 files) | 97 tests, one per ledger acceptance test or regression |
| `parity/reverse-engineer-anything/` | spec, ledger, design record, reference fixtures, E2E transcripts, three independent reviews, this report |

Activation:

```bash
pi install .                                                  # repository root, exposes ./skills
pi -p --no-session --skill skills/reverse-engineer-anything "…"  # per-session, development path
node skills/reverse-engineer-anything/scripts/rea.mjs route /bin/ls --json
```

## Source-to-Pi mapping

| Reference behavior | Pi behavior | Requirement IDs |
| --- | --- | --- |
| Evidence envelope + vocabularies | `lib/envelope.mjs` | ENV-001…007, OBS-001…004 |
| Error contract (`error-contract.schema.json`) | `lib/errors.mjs`, `lib/error-vocabulary.mjs` | ERR-001…004 |
| Session ledger, retained evidence, bundle export/import | `lib/store.mjs`, `lib/store-io.mjs` | STORE-001…010 |
| `inspect_analysis_view` | `lib/views.mjs`, `discipline-audit` | VIEW-001…004, ARCH-001, ARCH-002 |
| `record_unknown` / `update_unknown` / resolution | `lib/unknowns.mjs` | UNK-001…004, SEC-002, SEC-003 |
| `binary_session` availability with effects | `lib/capabilities.mjs` | CAP-001…004, MACOS-001…003 |
| "Route the target first", ambiguity refusal | `lib/route.mjs` | ROUTE-001…007 |
| `analyze_javascript_application` | `lib/formats/javascript*.mjs` | JS-001…011 |
| `inspect_artifact` | `lib/formats/{artifact,zip,asar}.mjs` | ART-001…007 |
| `inspect_binary_layout` | `lib/formats/binary*.mjs` | BIN-001…006 |
| `inspect_go_binary` | `lib/formats/gobinary.mjs` | GO-001…004 |
| `inspect_web_network_capture` | `lib/formats/har.mjs` | HAR-001…007 |
| The skill's discipline rules | `lib/discipline.mjs`, `references/*` | DISC-001…007 |
| REA's skill install path (`~/.agents/skills`) | `skills/` + `pi.skills` package field | SKILL-001…006 |
| Independence from REA | no non-builtin imports, no network, no process, no `parity/` reads | INDEP-001…003 |

## Verification results

All commands were run on macOS 15 / Darwin arm64, Node v24.21.0, Pi 1.2.0.

| Check | Command | Result |
| --- | --- | --- |
| Unit + contract + regression tests | `node --test skills/reverse-engineer-anything/tests/*.test.mjs` | **96 pass, 0 fail, 1 skipped** (the opt-in live Pi E2E) |
| Formatting and lint for the port | `biome check --error-on-warnings skills/reverse-engineer-anything parity/reverse-engineer-anything` | exit 0 |
| Pi skill loading (real loader) | `node scripts/check-pi-mechanisms.mjs` | exit 0, 58 skills loaded including this one |
| Pi end-to-end, per-session | `pi -p --no-session --skill skills/reverse-engineer-anything "…route /bin/ls…"` | replied `inspect-binary-layout` / `mach-o`; transcript in `fixtures/e2e/pi-skill-load.txt` |
| Pi packaging, isolated agent dir | `HOME=… pi install <repo>` → `pi list` → `pi -p` discovery → `pi remove` | install, discovery and removal recorded in `fixtures/e2e/pi-install-cycle.txt` |
| Parity ledger | `node skills/port-harness-capability/scripts/validate-ledger.mjs parity/reverse-engineer-anything/ledger.json --root .` | `{"verdict":"VERIFIED","counts":{"VERIFIED":95,"NOT VERIFIED":0,"INCONCLUSIVE":0,"NOT APPLICABLE":17}}` |
| Reference comparison | REA 6.4.0 `analyze-javascript-application` on the same target | the port matches every Electron/IPC summary counter exactly (windows 1, explicit web preferences 2, bridges 1, exposed members 1, native bindings 1, IPC operations 2, literal channels 1, renderer transmissions 1, main handlers 1, paired 1, unpaired 0) |
| Code compliance for the port | `node scripts/check-agents-compliance.mjs` | no violations in `skills/reverse-engineer-anything` or `parity/reverse-engineer-anything` (notes only) |

| Claim re-measurement | `node parity/reverse-engineer-anything/scripts/verify-claims.mjs --reference --pi --pr` | every claim in this report re-measured by a re-runnable script; output in `verification.json` |

Repository gates that fail, and why they are not this port's regressions: `bun run ci`,
`check:agents`, `check:tests` and `verify-fresh-install` fail identically on a pristine `fc39b16c`
worktree. Evidence: `fixtures/repo-gates/pristine-head.txt` (7 biome errors and 3 vitest violations
in `extensions/pi-xai-oauth` and `extensions/pi-anthropic-oauth`; `verify-fresh-install` times out in
both trees with identical output).

### Independent review

Three fresh `pi -p` reviewers read the first complete revision, one per focus. Their confirmed
findings were fixed with regression tests; the raw reviews are in `reviews/`.

| Focus | Confirmed findings | Disposition |
| --- | --- | --- |
| Parity coverage | 9 | 8 fixed (fixture annotation key, 12 undeclared reference operations, statistics semantics, undocumented zero fields, `OBS-002` wording + test, ungrounded `NOT APPLICABLE` evidence, summary-view shape, vacuous assertions); 1 handled as labelled evidence captures plus an opt-in re-runnable test |
| Security and state integrity | 8 | all fixed: ZIP member cap and unreadable-member integrity, path traversal through `evidence_id`/`unknown_id`/bundle, HAR query and header credential redaction, unsynchronized unknown revisions, lock ownership, nesting depth |
| Architecture and maintainability | 10 | 8 fixed (discipline audit wired, validated evidence reader, artifact coverage, duplicated api-surface, dead code removed, name resolution reachable, flag scoping, typed HAR parse error); 2 recorded as notes already covered by decisions |

## Re-measurement of these claims

The claims above are re-measured by `scripts/verify-claims.mjs`, which a reviewer reruns instead of
trusting this document. Its first run found two real problems, both fixed before this revision:

- The claim text said "115 VERIFIED citations" and "48 shipped files". The real numbers are 95
  VERIFIED rows and 31 shipped files. The verifier had hardcoded both, so it reported the wrong
  figures while passing, and one citation (`JS-010`) matched a test-name prefix rather than the full
  name. The counts are now computed, the citation is exact, and the verifier fails if a named
  citation does not match a declared test exactly.
- The suite size was reported as 120 tests in 16 files. The true size of this skill's suite is 97
  tests in 14 files; the larger figure came from a glob that also matched the repository's other
  skill. Every count in this report and the pull request was corrected.
- `inspect-analysis-view <missing-path>` escaped as an untyped `execution_failure`. It is now a
  typed `invalid_request` with a named issue, with a regression test (`STORE-011`, `ARCH-005`).

The verifier then found two bugs in itself. It required 120 passing tests, a threshold left over
from the wrong count, so it failed on a correct suite. And it spawned `pi` with an inherited open
stdin pipe, which made `pi -p` wait for an EOF that never arrived, so it reported the live-session
claim as false when a direct run in a shell answered correctly in seconds. Both are fixed: the child
now gets `/dev/null` on stdin plus an explicit timeout, and the suite check asserts the exact counts
this report states. The full battery runs in about 17 seconds.

The script then checks, among others: the shipped skill has no reference to the upstream package,
its 75 import specifiers are all `node:` builtins or relative, production code never reads this
evidence tree, the ledger validates and all 95 VERIFIED citations resolve to a test that exists by file
and by exact name, the reference fixture really holds 170 tools and 6 prompts, the port reproduces
all 11 reference summary counters including 9 IPC counters on the same tree, the analyzer writes no
marker file a target's code would have created, evidence is on disk and deduplicated after a repeat
run, a traversal-shaped identifier is refused, credential values never reach the evidence, an
oversized member is refused, the port adds no compliance violation, and the repository gates were
already red before this branch.

PR #84 was merged at 2026-10-13T07:20:24Z, while this re-measurement was still running. The
corrections above therefore ship as a follow-up PR rather than an amendment, and this document
describes the state of the follow-up branch: the merged revision carried the untyped error and the
wrong counts.

## Parity status

VERIFIED 95 · NOT VERIFIED 0 · INCONCLUSIVE 0 · NOT APPLICABLE 17 (validator-derived).

The 17 out-of-scope rows are deliberate and named in `ledger.json` with the prerequisite each one
needs: provider decompilation (Hopper/Ghidra/IDA), Android code and resources (JADX/apktool), JEB,
ADB devices, firmware (Binwalk/Unblob), packets and signals (TShark/sigrok), recorded crashes
(pwntools), managed .NET, WASM (WABT), EVM, SQLite, runtime capture (process/browser/UI/Frida), the
macOS/Apple metadata family, the `compare_*` and `project_*` families, reconstruction verification,
and REA's own MCP server and distribution.

**Critical gap, stated plainly:** this is not 100% of REA's 170-tool surface. It is 100% of the
engine-free tier the user asked for, plus the whole Evidence, error, store, unknown and discipline
contract that every REA operation shares. The remaining families are not implemented and are
declared unavailable with their prerequisites rather than approximated.

## Security and maintenance

- Threat model: untrusted artifacts. Member paths are confined and never written to disk; a member
  over 256 MiB or one that fails to decompress is refused; nesting depth is bounded; `evidence_id`
  and `unknown_id` are validated before they name a file; credentials are dropped from captures and
  never written to the store; no shipped module can import a network or process module, and none
  calls `fetch`. Each of these is asserted by a test.
- State ownership: the session store owns evidence, unknowns and the ledger. Evidence is immutable;
  the ledger is derived and rebuildable; unknown updates are revision-checked; ledger and unknown
  writes share one ownership-checked lock.
- Maintenance obligations: the skill pins no Pi API beyond the skill format and the CLI conventions
  of Pi 1.2.0; `SKILL.md`'s frontmatter is validated by Pi's own parser in the test suite. The
  analyzer is a hand-written lexer, so its counts are its own measures — documented in
  `decisions.md` and in the references, not just in this report.

## Remaining gaps

1. The 17 out-of-scope families above. None can be implemented without installing a third-party
   engine, and the reference itself reports `capability_unavailable` for several of them on this
   host.
2. The JavaScript analyzer is not a full parser. It resolves literal and relative specifiers
   reliably; dynamic ones stay unresolved with a limitation, by design.
3. `SKILL-005` (a live Pi session) is a recorded transcript plus an opt-in test (`PI_REA_E2E=1`); it
   is not part of the default suite because it needs a configured model.
4. A sibling effort exists in this repository's `feat/pi-rea` worktree (`extensions/pi-rea`), which
   advertises REA's full tool contract as an extension and implements a small subset (its own ledger
   reports NOT VERIFIED 165). It ships a skill with the same name as this one. If both land on main,
   Pi will load one of the two and warn about the collision; they are not currently reconciled.

## Final verdict

**VERIFIED** — for the scoped contract in `spec.md`: the engine-free analyzers, the Evidence and
error contracts, the session store, the unknown registry, the routing and availability surface, the
discipline layer, and independence from REA. The verdict is derived by
`validate-ledger.mjs`, not asserted here.
