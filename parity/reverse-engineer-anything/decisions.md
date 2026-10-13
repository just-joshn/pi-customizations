# Design decisions

## What was grounded, and how

Every requirement in `spec.md` cites one of: REA's public docs (`REA-DOCS`), its
published MIT skill (`REA-SKILL`), or a measured observation of
`npx -y rea-agents@6.4.0` on macOS 15 / Node 24.21.0 (`REA-CLI`, `REA-MCP`,
`FIXTURE`). Raw captures live in a scratch directory; reduced fixtures and their
provenance live in `fixtures/`. Nothing in this port is copied from REA source:
the port reads the same *observable* contract and re-derives the implementation.

## Decision 1 — what the deliverable is

| Option | Coverage | API fit | Complexity | Testability | Verdict |
| --- | --- | --- | --- | --- | --- |
| **A. Prose-only skill** instructing the agent to shell out to `otool`/`unzip`/`node` | Wide but shallow | Pi skills are the right mechanism | Lowest | Weak: IDs, coverage, ledgers and error shapes become prose the model may drift from; parity cannot be measured | Rejected |
| **B. Skill + Node-only CLI core** (`SKILL.md` + `references/` + `scripts/`) | The engine-free analyzer families, plus the full evidence contract | Skill for the procedure, bundled scripts for the deterministic parts — exactly the split Pi `docs/skills.md` describes | Medium | Strong: one entry point, real assertions, fixtures from the reference | **Chosen** |
| **C. Pi extension with registered tools** | Same as B plus mechanical enforcement of the discipline | An extension is the right mechanism for runtime enforcement, not for procedural investigation | Highest; also drags a TypeScript package, coverage gates, and dependency surface into a skill that must stay dependency-free | Strong | Rejected for now; recorded as the natural follow-on if the discipline ever needs to be unbypassable |

Chosen: **B**. The user asked for a Pi *skill*, the capability is procedural, and
the deterministic parts (envelope construction, IDs, store, coverage, errors)
are exactly the parts that must not be left to model discretion.

## Decision 2 — how the port talks to its caller

| Option | Verdict |
| --- | --- |
| A native MCP server re-implementing REA's 170 tools | Rejected: out of scope by the user's choice, and the port must not require a background server for on-demand work |
| A library with no CLI | Rejected: the skill's instructions need a stable command surface, and the harness wants the real user entry point exercised |
| **A single CLI, `scripts/rea.mjs`, with REA's operation names** | **Chosen** |

The command names are the parity surface that matters most to a user or agent
moving between the two tools: `analyze-javascript-application`,
`inspect-artifact`, `inspect-binary-layout`, `inspect-go-binary`,
`inspect-web-network-capture`, `inspect-analysis-view`, `capabilities`,
`record-unknown`, `update-unknown`, `list-unknowns`, `evidence-export`,
`evidence-import`. A `--help` on any command prints its own usage, and
`--schema` prints its argument schema, mirroring the reference's global options.
Unknown flags are rejected rather than ignored, because a silently ignored
`--integrity-policy` is a correctness bug in an evidence tool.

## Decision 3 — where state lives

| Option | Verdict |
| --- | --- |
| A session server holding evidence in memory (REA's MCP shape) | Rejected: Pi sessions are short-lived and the agent may be interrupted; in-memory evidence would vanish with the process |
| **A store directory on disk, `<cwd>/.rea` by default, `--store` override** | **Chosen** |

Layout: `sessions/<session>/ledger.json`, `sessions/<session>/evidence/<id>.json`,
`sessions/<session>/unknowns/<id>.json`, and a `current` pointer file. Evidence
is written (temp file + `fsync` + rename) before stdout is produced, so a
record cited in a conversation always exists on disk. Records are immutable;
the ledger index is rewritten atomically and rebuilt from the evidence directory
when it is missing, which makes an interrupted run recoverable without a
journal. A `.rea/` directory is added to `.gitignore` because it is working
state, not a deliverable.

The store is the port's answer to the reference's session ledger. Bundles are a
single canonical JSON file: `{schema, generated_at, store, records[], unknowns[]}`
with records sorted by `evidence_id`, so two exports of an unchanged session are
byte-identical apart from `generated_at`, which `--stable` omits for diffing.

## Decision 4 — identity

| Identity | Scheme | Why |
| --- | --- | --- |
| `evidence_id` | `ev_` + SHA-256 of canonical JSON of `{operation, parameters, subject.digest.sha256, normalized_result}` | Content-addressed like the reference's `ev_` + 64 hex. The reference's exact preimage is unknown (`spec.md` Unknowns), so the port guarantees stability, input-sensitivity and collision behaviour, and records that literal equality is not claimed. |
| `node_id` | `<prefix>_node_` + SHA-256 of `{kind, identity.key, artifact sha256}` | Matches the reference's `jag_node_<64 hex>` shape and its "identity is artifact-local key" strategy. |
| `observation_id` | `<prefix>_observation_` + SHA-256 of canonical JSON of `{label, properties}` | Matches the reference's `semantic-content-sha256` strategy: the same observation on the same content is the same ID. |
| `unknown_id` | `unk_` + SHA-256 of the normalized question | Duplicate questions must be rejected, so the ID must be a function of the question. |
| directory subject digest | SHA-256 of a canonical sequence of `path`, mode, size, content-digest, with paths sorted by code point | The reference does not publish its tree digest; this makes it deterministic and path-independent. Recorded as an intentional deviation. |

## Decision 5 — what "unavailable" means here

The port never approximates a provider-backed operation. `capabilities` lists
every operation the port knows about, including ones it cannot perform on this
host, with `available: false`, an `availability_code`
(`missing_prerequisite`, `unsupported_host`, `unsupported_format`), a `reason`
naming the missing prerequisite, and a `remediation.action`. Calling one of them
returns `capability_unavailable` with `retryable: false` and the same details,
which is the reference's own behaviour on macOS for `inspect_binary_layout`.

This is also how the reference's whole provider tier (Hopper/Ghidra/IDA), and
the Android, firmware, packet, signal, crash, JEB and ADB tiers, are represented:
present in the matrix, absent in capability, never faked in output.

## Decision 6 — deviation from the reference's platform boundary

`inspect_binary_layout` in REA 6.4.0 is pwntools-backed and refuses everything
outside Linux x64 (`fixtures/reference/rea-6.4.0-errors.json`, case 1). The port
implements the same operation with an in-process reader for Mach-O (including
fat/universal), ELF (both classes, both endiannesses) and PE, and therefore
*exceeds* the reference on macOS. The deviation is deliberate and is recorded as
a limitation on every such result, so a reader comparing the two outputs is told
how they differ rather than left to discover it.

## Domain model

Entities:

- **Session** — a store directory with an ID; owns the ledger, the evidence
  files and the unknown registry. Created lazily on first write.
- **EvidenceRecord** — an immutable envelope. Owned by the session; addressed by
  `evidence_id`; never edited after write.
- **Observation** — belongs to a record's graph or inventory; carries its own
  authority, state, confidence, coverage and limitations.
- **ArtifactRef** — `{available, artifact_id, sha256, logical_path?, bytes?}`;
  the content identity every location and observation refers to.
- **Unknown** — an append-only chain of revisions. Owned by the session;
  identified by question.
- **CapabilityEntry** — `{operation, available, reason, availability_code,
  effects, limitations}`; derived from the host at call time, never cached
  across hosts.
- **RouteDecision** — `{target, kind, format, operation, confidence, alternatives}`;
  produced by content sniffing plus the supplied path.

State ownership and lifetimes:

- Operations read the target and write only through the store. No operation
  writes to, moves, or modifies the analyzed artifact — `mutates_artifact` is
  false for every entry in the matrix, and a test asserts it.
- Evidence records are immutable and live until the session is deleted.
- The ledger index is derived state: it can be rebuilt from `evidence/`, so a
  lost or truncated index is a recoverable condition, not data loss.
- Unknowns are immutable revisions; the head is the highest revision.

Invariants:

1. Evidence is on disk before it is reported.
2. `evidence_id` is a pure function of the analyzed content and parameters.
3. A record with `coverage.truncated === true` has a numeric `omitted_count`.
4. `state: "observed"` appears only in records whose operation ran the declared
   target. Static analysis produces `inferred`.
5. No conclusion may claim absence from a result whose coverage is partial.
6. `revision` increments by one; a stale `expected_revision` fails.
7. Every path that reaches the filesystem is resolved and confined to the target
   or the store.
8. Static analysis never executes, imports, or evaluates target content.

Concurrency and idempotency:

- One writer per session is assumed. Ledger rewrites take an exclusive
  `O_EXCL` lock file with bounded retry and backoff, and write via rename, so a
  concurrent reader sees either the old or the new ledger.
- Repeated identical analysis is idempotent: the same `evidence_id` is returned,
  the record is not rewritten, and `repeat_count` increments.
- Nothing in the port requires network access, so retry semantics are limited to
  filesystem contention.

Validation boundaries:

- CLI arguments: unknown flag → `invalid_request` with the issue path; missing
  required argument → same; numbers validated as non-negative integers.
- Target paths: must exist; resolved to a real path; directory traversal in
  archive members is refused.
- Store: must be writable; a store under a symlink is resolved before writing.
- Archive members: logical paths only, never written to disk during analysis.

## Verification consequences of these decisions

- The envelope, store, view, unknown and error contracts are unit-testable
  without any fixture beyond the reference JSON already captured.
- The analyzers are testable against the synthetic fixture target committed in
  `fixtures/targets/`, and against the reference's own output for the same
  target where the reference can run it here.
- The skill layer is testable through the real Pi loader (`pi --skill`,
  `pi install`, `/reload`), which is the harness's integration layer.

## Decision 7 — what the independent review changed

Three fresh `pi -p` reviewers (parity coverage, security and state integrity, architecture and
honesty) read the first complete revision. Their confirmed findings were fixed, and each fix has a
regression test. This section records the decisions that came out of that pass, because several are
deviations a later reader would otherwise have to rediscover.

**Member limits.** A ZIP member may not declare or decompress more than 256 MiB
(`MAX_MEMBER_BYTES`); `inflateRawSync` is called with `maxOutputLength` so a hostile archive cannot
exhaust memory. A member that cannot be read is an integrity problem, not a silent partial success:
under the default policy it fails the call, and under `record-and-continue` it is recorded as a
contradiction and the result's coverage becomes `partial` with an exact `omitted_count`.

**Identity is validated wherever it names a path.** `evidence_id` and `unknown_id` are matched
against `^ev_[0-9a-f]{64}$` and `^unk_[0-9a-f]{64}$` before they are joined onto a directory, so a
bundle or a CLI argument cannot name a file outside the store. An imported unknown must also hash to
its own id, matching the content-address check already applied to evidence records.

**One lock, owned by its writer.** The ledger and the unknown registry share one lock, so two
concurrent writers cannot lose a revision. The lock file carries the writer's UUID and is removed
only by the writer that still owns it, so a stale takeover cannot free a successor's lock.

**Credential redaction in captures.** The reference preserves query values because they are part of
the observed request line. This port does the same, except where the *parameter name* says the value
is a credential (`token`, `key`, `secret`, `signature`, `password`, `session`, …), which is replaced
with `[redacted]`. The header redaction list is similarly broadened to cover signing and access-key
headers. Ordinary query values and fragments stay, because removing them would change the evidence.

**Nesting limits.** `canonicalJson` refuses a structure nested deeper than 64 levels with a named
error instead of a `RangeError`, and the ASAR reader stops at 64 header levels and reports `partial`
coverage. Depth is an input like any other, so it has a bound.

**The discipline layer is reachable.** `discipline-audit` runs `auditEvidence`, `unresolvedCitations`
and `absenceClaimAllowed` over the session or a bundle. Before this, the module was tested but no
command called it, and `SKILL.md` told the agent to run a command that only re-projected a summary.

**Flags are scoped to their command.** Only `--json`, `--help` and `--schema` are global. A boolean
such as `--overwrite` or `--stable` is accepted only where it is declared, and anywhere else it is
rejected as an unknown flag, which is what the port's own error contract promises.

**Statistics are this port's measures.** `visited_ast_nodes` counts tokens, `findings` counts
observations, and `modules` counts resolved specifiers. The names match the reference because the
result shape does; their meaning does not. The analyzer says so in its limitations, and
`package.json` is now sized once rather than twice. `ambiguous_renderer_transmissions`,
`sender_validation_observations`, `utility_processes` and `resolved_utility_entrypoints` are reported
as `0` because this port does not detect those constructs; a limitation on every such result says
that a zero means "not observed here", never "absent".

**The summary view restates the producer's coverage.** `coverage.application` (and `coverage.semantic`
when the producer has one) carries the producer's own coverage block, while the view's own page
counters stay at the top level. The reference nests its producer summary under `electron`; this port
flattens it, and `coverage` is the field a reader should use to judge completeness.

**Evidence captures are labelled as such.** `fixtures/e2e/*.txt` are transcripts of real Pi 1.2.0
runs, not re-runnable assertions. The ledger cites them for the two requirements whose acceptance is
a measured observation, and a separate opt-in test (`PI_REA_E2E=1`) re-runs the `--skill` load so the
check can be repeated when a model is available.
