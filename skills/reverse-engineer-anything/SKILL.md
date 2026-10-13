---
name: reverse-engineer-anything
description: >-
  Reverse engineer a shipped artifact — an extracted JavaScript/Electron app or ASAR, an archive or package,
  a Mach-O/ELF/PE binary, a Go binary, or a retained HAR capture — and answer questions about how it works with
  evidence. Use when a claim depends on shipped bytes rather than available source: decompiling or tracing a
  feature, comparing versions of a binary, explaining what a bundled app does, reading a package inventory, or
  reconstructing behavior for a new implementation. Runs locally, writes nothing outside the target and the
  session store, performs no execution, and states what it could not establish. Skip it for ordinary analysis of
  a complete source repository — use normal repository tools there.
license: MIT
compatibility: "Pi coding agent 1.1.0+. Node.js 22.19+ and nothing else: no npm package, no analysis engine, no network, no upstream install. This skill is an independent reimplementation and never calls the project it is measured against."
metadata:
  license-of-the-behavior-it-reimplements: MIT (morluto/rea)
  parity-baseline: upstream release 6.4.0, upstream skill version 41
  independence: no runtime, build, network or configuration dependency on the upstream project
  parity-evidence: repository path parity/reverse-engineer-anything/ledger.json (development evidence, not required at runtime)
---

# Reverse engineer anything

Investigate a shipped artifact and report what is true, what is inferred, and what remains
unknown. Every result is an Evidence record with a stable ID, a subject digest, coverage, and
limitations, held in a session store you can re-read and export.

Run the port's own CLI through Node. Paths below are relative to this skill's directory, which Pi
prints in the skill list.

```bash
node scripts/rea.mjs <command> [arguments] [--json]     # --store <dir> defaults to .rea
```

## When to run this, and when not to

Run it when a claim depends on bytes that shipped: a compiled binary, a bundled application, a
package, a recorded capture. Do not run it to analyze a complete source repository — normal
repository tools answer that better, and this port would only add indirection.

**This port performs no execution and needs no analysis engine.** It reads bytes, parses structures,
and reports static candidates. It cannot decompile a native function (that needs Hopper, Ghidra or
IDA), decode an APK's code (that needs JADX), extract firmware, or read packet captures. Those
operations are listed as unavailable with the reason, and [`references/connection-and-recovery.md`](references/connection-and-recovery.md)
says what to do instead. Never present a static candidate as something that was witnessed running.

## Route the target first

Decide the route from the target, before asking any other question:

```bash
node scripts/rea.mjs route /absolute/path/to/target --json
```

| Target | First command |
| --- | --- |
| Extracted JavaScript/Electron tree, or an `.asar` | `analyze-javascript-application <path>` |
| Archive or package (`.zip`, `.apk`, `.ipa`, `.msix`, `.appx`) | `inspect-artifact <path>` |
| Mach-O, ELF or PE binary | `inspect-binary-layout <path>` |
| Go binary (Mach-O/ELF/PE with `Go buildinf:` bytes) | `inspect-go-binary <path>` |
| Retained HAR capture | `inspect-web-network-capture <path>` |

If the user says only "my app" without a name, path, or selected target, ask which artifact before
searching. A path in an unrelated report or a nearby test fixture does not select the target. When
you have a name instead of a path, resolve it against installed applications rather than guessing:

```bash
node scripts/rea.mjs route --name "Notes" --json     # macOS: /Applications and ~/Applications
```

One match routes to its operation; no match or several matches is an error listing the candidates,
and several matches must be resolved by the user.

## Run the investigation

1. **Write the questions down.** Turn the request into a checklist of questions and the evidence each
   one needs. Resolve the target from the conversation and the workspace before asking again.
2. **Reuse retained evidence.** Run `node scripts/rea.mjs analyze-javascript-application <target> --json`
   once, note the `evidence_id`, and read further views from the store instead of re-analyzing.
3. **Start with the summary, then drill.** For JavaScript and inventory results, request a summary
   view first, then select the section or node the question needs:
   ```bash
   node scripts/rea.mjs inspect-analysis-view <evidence_id> --view summary --json
   node scripts/rea.mjs inspect-analysis-view <evidence_id> --view section --selector javascript-module --json
   node scripts/rea.mjs inspect-analysis-view <evidence_id> --view item --selector <node_id> --json
   ```
   A file path can carry several graph roles; select the `node_id`, not the path.
4. **Follow one question at a time.** Open the relevant reference, trace from an entry point through
   the relationships the graph reports, and stop when the answer is supported or the gap is named.
5. **Separate the three kinds of statement.** An *observation* is recorded in the artifact's bytes.
   An *inference* is a static relationship that has not been run. An *unknown* is what the evidence
   cannot answer — record it:
   ```bash
   node scripts/rea.mjs record-unknown --question "<what is still unanswered>" --severity high \
     --domain "<subsystem>" --required-authority static-relationship-inference --required-confidence high \
     --supporting <evidence_id> --recommended-probe "<what would settle it>" --json
   ```
6. **Corroborate with the evidence type the claim needs.** Static analysis cannot establish runtime
   behavior. If the question needs runtime evidence and no declared target can be run, say so instead
   of reasoning from syntax alone.
7. **Close the checklist.** Mark each question answered, partially answered, or unresolved. Keep a
   negative result bounded by its search: "no match in this inventory" is not "does not exist".

## Report what the evidence supports

- Cite the `evidence_id` and the specific `node_id` or occurrence for every conclusion.
- Say which authority a fact came from (`artifact-bytes`, `ast-static-analysis`, `static-relationship-inference`).
- Reproduce the limitations that came with the result; do not summarize them away.
- When the user asks you to build something, use normal coding tools and keep observed behavior
  separate from design choices.
- Before you quote a result, check the session against the rules a report must satisfy:
  ```bash
  node scripts/rea.mjs discipline-audit --json
  ```
  It reports any record with no limitations, an observation that claims more than its authority, an
  execution claim with no runtime record, or a citation that does not resolve. It also lists which
  records may support an absence claim. If a result has `coverage.status: "partial"`, no absence
  claim may rest on it.
- Persist the session when the work must survive it, then read it back:
  ```bash
  node scripts/rea.mjs evidence-export <path>/session.rea-bundle.json --json
  ```

## Read only the relevant reference

- Binaries, Go metadata, archives and packages:
  [`references/native-and-artifacts.md`](references/native-and-artifacts.md)
- JavaScript/Electron applications, module views and feature tracing:
  [`references/javascript-applications.md`](references/javascript-applications.md)
- Evidence, views, paging, unknowns, export and verification:
  [`references/evidence-workflows.md`](references/evidence-workflows.md)
- Runtime observation, and why this port stops at static evidence:
  [`references/runtime-observation.md`](references/runtime-observation.md)
- Blockers, missing prerequisites and recovery:
  [`references/connection-and-recovery.md`](references/connection-and-recovery.md)

## Finish the task

Explain the finding in plain language, tie it to the evidence IDs, name what remains unknown, and
state the boundary that produced the answer. If the investigation opened a session store, leave it
in place — the user may want to read the evidence later.
