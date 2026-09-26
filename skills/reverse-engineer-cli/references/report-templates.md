# Evidence and report templates

Use these structures in the generated reports. Replace examples with evidence; leave unavailable facts explicitly UNKNOWN. Reports must distinguish installed and repository models when versions differ.

## behavior.md

```markdown
# CLI behavior

## Scope and identity
Target, artifact hash, version evidence, platform/runtime, repository revision and relationship.
Requested behaviors, exclusions, remaining required gaps, completion status.

## Commands
Link source/command-tree.json. Describe args/options, aliases, defaults, repeatability,
ordering, -- semantics, conflicts, validation, and evidence IDs.

## Configuration and environment
Discovery locations, precedence per field, merges, empty/unset values, malformed input,
cwd effects, relevant env variables, evidence and unknowns.

## Input, output and errors
stdin/file input, stdout/stderr bytes and formatting, machine output, TTY/color/locale,
exit codes, signals, timeout/broken-pipe behavior, error timing and cleanup.

## Effects and edge cases
Filesystem reads/writes, caches, children, network, important algorithms and boundaries.
State observation coverage and unmeasured effects explicitly.

## Reproduction
One command, required artifacts/tool versions, expected assertions, last run ID,
failures and gaps. Link raw evidence for major claims.
```

## architecture.md

```markdown
# CLI architecture

## Entrypoints and version relationship
Launcher chain; installed/repository distinction; matching evidence and tested scope.

## Ownership and state
Launcher: resolves runtime/package.
CLI boundary: parsing, syntax validation, dispatch.
Configuration: discovery, reading, precedence and merging.
Application: operation, algorithm, state transitions.
Adapters: filesystem, network, subprocesses, credentials, services.
Presentation: serialization, stdout/stderr, error/status mapping.

## Data flow
Diagram tied to entrypoint/symbol/trace references. Label inferred edges.
Explain important inputs, transformations, state reads/writes and failure paths.

## Boundaries and limitations
Dependency-owned behavior, native/runtime boundaries, unavailable symbols/source,
instrumentation/build differences and remaining hypotheses.
```

A directory is not automatically a component. Include it only when it owns behavior or state.

## evidence.md

```text
C-014
Claim: --config selects config-b instead of TOOL_CONFIG=config-a for field endpoint.
Level: PROVEN | OBSERVED | SUPPORTED | INFERRED | UNKNOWN
Target: identity.json entry and SHA-256; repository revision if relevant
Scope: command, field, platform, tested inputs
Probe: P-014, corpus run ID, argv/cwd/env/stdin/TTY, expected and observed result
Raw: exact stdout/stderr/snapshot path and byte/line/event location
Trace: path and event, tool version, process and coverage; or not collected
Source: revision, path, symbol, line range; correspondence evidence; or unavailable
Binary: artifact hash, module, relative address/symbol; or not needed
Alternatives: candidates and discriminating experiment results
Reproduce: command plus fixture/case and required tool/runtime versions
Limitations: what this evidence cannot establish
```

Keep claims narrow enough that their level applies to the whole claim. Separate observation from causal explanation when their evidence differs.

## Hypothesis ledger

```text
H-017
Question: Why does sync contact the service before reading project config?
Hypothesis: Authentication initialization sends the request.
Evidence for: probe/trace/source references
Evidence against: references or none found
Alternative: update check sends the request
Next probe: controlled credentials cache and local service, update check disabled
Status: OPEN
Resolution: observation, claim ID and evidence; move to resolved.md after direct resolution
```

## Reproduction manifest

Document artifacts and SHA-256 values, runtime/compiler/tool versions, PATH dependencies,
fixtures, corpus, traces to collect, normalization rules with evidence, expected comparisons,
last replay result, and any path remapping needed on another machine. Keep scripts runnable
without the original skill installation. Never list an unimplemented check as part of replay.
