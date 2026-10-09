# Cursor host source-discovery continuation

## Overview

The implementation owner now has the remaining API reading and an explicit transport-conflict record. Maintainers can recover the source captures and rerun quotation checks without changing the prior archive. This is discovery evidence only. It does not establish working services, frozen definitions, complete closure, or an acceptance verdict.

Writes are confined to `parity/research/cursor-host-continuation/`. The prior archive and the concurrently owned npm research directory were not edited. No commit was made. The only external actions were three unauthenticated public documentation GET retrievals. No model-backed Cursor execution, install, account change, secret read, service activation, external communication, or publication occurred.

The full parent contract and prior root and service reports were read. The coordinator personally read API lines 1-3011, including every requested continuation offset through line 2879 and the remaining tail. The coordinator personally read all 2994 OpenAPI lines. A final newline does not create an extra source line. Receipts use LF-delimited inclusive spans, not output-renderer line estimates. The general MCP snapshot and cloud capabilities capture were also read completely. Only pool lines 365-409 were personally read in this continuation.

`read-receipts.json` records those distinctions and full-source hashes. `input-read-receipts.json` records the parent contract, prior reports, and prior incomplete source lock. `prior-mcp-proposals.json` preserves twelve exact prior evidence edges. `prior-source-recovery.json` maps their original paths to owned preserved copies, without rewriting provenance. The full prior proposal files were not semantically read in this continuation. Their selected MCP edges were inspected.

## Key concepts

Three evidence states remain separate.

1. Prose states a documented contract under its context.
2. A published schema states structural constraints and descriptions. It does not prove the backend uses that validator.
3. A real reference observation establishes behavior only for the observed version, configuration, account rollout, and time.

The prior incomplete source lock records Cursor CLI `2026.10.01-e373342`, pstack `0.15.15`, and plugin revision `ccb5507cec1546dc88135c1139c811e6c59115ba`. This continuation did not revalidate that installation. Public web documents and API deployments are not pinned by that executable version. API v1 explicitly remains public beta in its preserved lines 3-6. OpenAPI `info.version` is `1.0.0`; that is not a backend deployment identity.

Local Cursor MCP, saved personal/team cloud MCP, v1 inline MCP, and self-hosted worker routing are separate contexts. SSE used for a run stream or a pool watch is also a different contract from SSE used for MCP.

## How it works

### Transport reconciliation remains context-sensitive

The following quotations have exact inclusive spans and full-file hashes in `dependency-proposals.json`. Paths below are relative to this continuation directory.

| Context | Exact evidence | Narrow conclusion |
| --- | --- | --- |
| General Cursor MCP | `preserved/snapshot-mcp.md`, lines 19-25. The table names `stdio`, `SSE`, and `Streamable HTTP`. | General MCP documents all three. Its Local/Remote server placement does not promise Cloud Agent support. |
| Saved cloud custom MCP | `preserved/docs_cloud-agent_capabilities.md`, lines 37-39. "You can add custom MCP servers using either **HTTP** or **stdio** transport. SSE and `mcp-remote` are not supported." | An explicit prohibition exists. The surrounding management context does not explicitly restrict that prohibition to UI input alone. |
| v1 inline creation | `preserved/docs_cloud-agent_api_endpoints.md`, lines 123-125. "Transport type: `http`, `sse`, or `stdio`. Defaults to `http` for remote servers with `url`, and `stdio` for servers with `command`." | v1 prose explicitly includes SSE. |
| v1 schema | `preserved/docs-static_cloud-agents-openapi.yaml`, lines 212-242. `RemoteMcpServer.type` has `enum: ['http', 'sse']`. | The published remote branch permits SSE structurally. This agrees with v1 prose, not with a universal cloud exclusion. |
| Self-hosted workers | `preserved/pool.md`, lines 387-396. The table routes `HTTP / SSE (url)` to `Cursor backend` and command stdio to the worker. | Another cloud-related context names SSE. This is a documented route, not an observed connection. |
| Hook contracts | The preserved prior hook edges cover `snapshot-hooks.md`, lines 1042-1084 and 1107-1129. They distinguish HTTP/SSE URL fields from stdio command fields. | Hook vocabulary corroborates SSE somewhere in Cursor. It does not establish every cloud entry point's transport policy. |
| Legacy v0 API | `retrievals/api-v0.md`, lines 1-10. The page labels itself legacy and says MCP is not yet supported by the Cloud Agents API. | That prohibition is version-scoped to the v0 page. It cannot override v1 inline definitions. |

The full-source SHA-256 values for the main conflict sources are:

```text
snapshot-mcp.md
8f6b54387a93616c82e2087ac5f2198c150832406c4c280880a7350e610c5e7e

docs_cloud-agent_capabilities.md
42885b553c13ff35527334cc837d106fabcc06fd72c43a46538d4f55953a0512

docs_cloud-agent_api_endpoints.md
d6aba3b8f36370e7f1882ce84089fdf2f1a04fb37392fa2c3606cd78271080d0

docs-static_cloud-agents-openapi.yaml
664e695207e9f72dd7dd296d60b576e68575f8e71ce18e6263a554850c072570

pool.md
b67e7f5ed22ce48d371e451c5c457d6630357b33d3d5e32ce1c9f6423b7bc41f

api-v0.md
c753c4ee18e097015309f9d0cfd20f59a28a54bdf54179fa5236e6e2cf0c14b2
```

A context-specific configuration exception, rollout difference, or stale document could explain the cloud conflict. These remain hypotheses in `unresolved-hypotheses.json`. No source explicitly establishes which explanation is correct. This report does not choose either a universal SSE allowance or a universal SSE rejection.

The capabilities HTTP claim places credentials outside the VM and proxies calls through the backend, at line 49. Its stdio claim exposes configuration and environment inside the VM, at lines 50-52. Those are documented boundaries. The self-hosted reference places the agent loop and inference at Cursor while worker tools execute on the machine, at `retrievals/self-hosted.md` lines 1-3. A worker is not thereby an independent model runtime.

### Schema constraints do not erase prose constraints

The OpenAPI MCP union uses `oneOf` at lines 244-247. Its stdio branch requires `name` and `command`; its remote branch requires `name` and `url`. Both have `additionalProperties: false`. Each branch's `type` is optional. Supplying both command and URL cannot satisfy either closed branch. Stdio accepts `args` and `env`. Remote accepts `headers` and OAuth `auth`. OAuth requires a nonempty `CLIENT_ID` at lines 153-174.

Create and follow-up MCP arrays both reference this union and have `maxItems: 50`, at lines 600-605 and 639-644. Unique names and transport defaults appear in descriptions, not corresponding structural keywords. `format: uri` does not structurally encode HTTP/HTTPS-only URLs or forbidden userinfo. The remote schema permits `headers` and `auth` together; prose's "or" does not settle exclusivity or precedence. These distinctions do not predict runtime validation.

The `mcp-remote` prohibition concerns a named program as well as a transport policy. A free `command` string in the stdio schema does not grant permission to run that excluded program. Nothing was installed or invoked.

Follow-up prose says inline definitions replace create-time definitions "for this run" and omission keeps the agent's current MCP configuration, at API lines 434-436. Whether a replacement persists into a later omitted run remains unresolved. Omission and an explicit empty array need separate observations.

### Additional conflicts exposed by the complete reads

The v1 agent status prose at API lines 365-371 names `ACTIVE`, `IDLE`, and `ARCHIVED`. The v1 schema at OpenAPI lines 267-270 permits only `ACTIVE` and `ARCHIVED`. Both concern v1 agent metadata. This is not explained by a v0/v1 distinction. Controller hibernation or release logic must not silently choose either document as a runtime oracle.

OpenAPI custom-subagent `model` at lines 507-517 has a string enum branch for `inherit` and a second unrestricted nonempty string branch. Under standard `oneOf` semantics, `inherit` matches both. This is a static schema overlap. No validator or backend rejection was executed, and no request-validation defect is claimed.

The preserved full OpenAPI omits `/v0/private-workers` paths that current endpoint prose documents. That is a public-schema discovery gap, not feature absence. `RepoConfig` schema descriptions still say GitHub, while current v1 creation prose names additional source-control providers. Provider coverage must not be narrowed to the schema's examples or descriptions without reconciliation.

The remaining API read adds provisional artifact, archive, environment, build, worker-token, secret-management, pool, claim, release, and failure-contract proposals. Each proposal retains context and exact evidence. Some paragraphs combine dependent conditions; these are discovery records, not independently frozen acceptance definitions. Other behaviors in the full sources still need independent extraction. No proposal count is a closure denominator.

### Candidate reference observations

`candidate-scenarios.json` contains eight unexecuted candidates. They compare saved cloud configuration, v1 inline creation, self-hosted routing, the separate `mcp-remote` restriction, follow-up persistence, prose-only validation, agent `IDLE`, and model inheritance.

Each candidate separates request validation, configuration save, tool discovery, connection, and actual tool execution. A successful create response cannot settle working transport support. Controlled protocol traces must distinguish legacy SSE from Streamable HTTP. A URL ending in `/sse` is not protocol proof.

These candidates require a separately authorized execution owner and working reference access. CLI and plugin versions can be anchored to the prior lock after revalidation. Live API and web deployments need their own exposed identity and configuration observations. If a backend build identifier is unavailable, that limitation must remain in the evidence rather than become a fabricated lock.

## Where things live

- `source-catalogue.json` records eight source captures and their full hashes. Seven were personally read completely. The pool capture was read only at the stated range.
- `preserved/` contains recovery copies of prior sources and response envelopes. Original bytes and original retrieval times are retained. Copies do not become new network retrievals.
- `retrievals/` contains three new official captures for API overview, legacy v0, and Self-Hosted Machines. Every capture includes requested and effective URLs, response status, headers, body, curl metadata, local start/end timestamps, and hashes.
- `dependency-proposals.json` contains 61 provisional nodes and 61 exact quotation edges. These are not requirements or runtime results.
- `prior-mcp-proposals.json` preserves twelve prior edges. `prior-source-recovery.json` supplies portable source locations for their original provenance paths.
- `read-receipts.json`, `input-read-receipts.json`, and `additional-read-receipts.json` distinguish full reads, partial reads, and selected-edge inspection.
- `unresolved-hypotheses.json` and `candidate-scenarios.json` retain the unsettled decisions and observations that could distinguish them.
- `linked-document-queue.json` retains 312 official source-link occurrences. Repeated occurrences are not unique dependencies or a closure count.
- `runtime-metadata.json` states observed checkout metadata and runtime identity limitations without private transcript paths.
- `audit-evidence.py` checks source hashes, exact LF quotation spans, graph endpoints, receipt consistency, and response-envelope hashes. `artifact-check.json` records zero structural errors. `audit-negative-control.json` records rejection of a deliberately wrong in-memory quote.

The artifact check does not perform semantic audit, schema validation, execution, parity comparison, or acceptance. The parent audit of 1102 spans over 58 source files has the same structural-versus-semantic limitation. Full-file hashes establish capture freshness. The span and verbatim text checks establish quotation location within those exact bytes.

## Gotchas and exact recoverable next action

The read-only how explainer corroborated the unresolved cloud conflict. Some line numbers in its prose did not match LF spans. The coordinator checked the bytes and did not promote those line numbers into authoritative evidence. A plan critic treated the capabilities prohibition as definitively UI-only. That interpretation was not adopted because the source does not explicitly establish that boundary. Neither helper supplies model-family diversity or authenticated physical-provider identity.

`pstack_context` exposed workspace and tool metadata, entry timestamps, and available model identifiers. Those observations do not authenticate provider identity or prove working entitlement. Local HTTP and read timestamps are not independently authenticated time attestations. No Cursor runtime metadata or backend execution identity was obtained.

Missing schemas, inaccessible successful service operation, and legitimate unavailable-service failures remain different evidence states. No failure path closes an unobserved successful branch. No acceptance definition, source lock, or parent ledger was modified.

Recover first with this structural check from the worktree root:

```bash
python3 parity/research/cursor-host-continuation/audit-evidence.py
```

The next source-discovery read is exact and needs no account access. Read `parity/research/cursor-host-continuation/preserved/pool.md` at offset 1 with limit 364, then offset 410 with limit 492 through line 901. Add new receipts only in the continuation directory. Reconcile the full pool context with the existing MCP routing quote and API reconnect, claim, release, and hibernation prose. Do not change prior receipts or infer working fleet behavior. Then follow the already-linked official TypeScript SDK reference with the same preserved response envelope to investigate inline configuration and transport mapping. Do not install an SDK or execute an agent.

Build the Lever shaped the rerunnable quotation checker. Model the Domain shaped the separation of captures, receipts, proposals, hypotheses, and scenarios. Prove It Works limited the reported result to directly checked artifact integrity rather than service operation. Their leaf skills were read in this session.
