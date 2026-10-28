## Problem

Ship a Pi package that claims agent-facing parity with rea-agents 6.8.0 on Pi 1.4.0. The oracle under `parity/pi-rea/` is 229 tools, 6 MCP prompts, Evidence envelopes, and a workflow skill. Official Pi setup writes an `mcp.json` server named `rea` so tools appear as `mcp__rea__*`; verify paths expect that prefix. Zero runtime dependency on `rea-agents` forbids wrapping `npx rea-agents`. The sibling extension already owns a session/Evidence kernel and a handful of analyzers behind `pi.registerTool`, but that surface names tools without the `mcp__rea__` prefix and targeted a stale 170-tool 6.4.0 contract. The non-obvious fork is whether parity means Pi-native `registerTool` depth or the official MCP discovery contract. This candidate forces the latter via `pi.registerMcpServer`.

## Usage (caller's view)

See [USAGE.md](./USAGE.md). Consumers install the package, get server name `rea` registered for the session, and call `mcp__rea__*` tools (deferred or kernel-direct). The extension factory only registers MCP + `/rea`; the child stdio process owns `ReaSession`. Agents export Evidence before `/new` because reconnect creates a fresh session. Independence forbids `rea-agents`; `@modelcontextprotocol/sdk` is allowed inside the server process.

## Shape

**Data structures first.** The load-bearing model is `ReaSession` as a two-phase state machine (`closed` | `open`+`TargetBinding`) plus two ledgers (`EvidenceLedger`, `UnknownLedger`) and a `ToolCatalog` transcribed from the 6.8.0 `tools/list` / `prompts/list` digests. Availability is derived from catalog implementation flags and open-target rules, not a parallel boolean map. `ToolOutcome` is a sum type (`operation` | `evidence` | `error`) so wire encoding cannot invent a finding for an unavailable tool. per foundational-thinking, model-the-domain, type-system-discipline.

**Registration shell is thin.** `src/index.ts` / `host.ts` call `pi.registerMcpServer("rea", { command: process.execPath, args: [package bin], exposure: "deferred", toolExposure: KERNEL… })` and register `/rea`. All REA capability lives in `src/mcp/*` + domain modules. Pi 1.4.0's `registerMcpServer` accepts only stdio or HTTP configs; there is no public in-process MCP transport, so "in-process" is rejected as a host API fiction. The clean-room server is our own Node stdio child. per boundary-discipline, experience-first (match the official client naming users already verify).

**Wire stays behind the interface.** MCP SDK request/response types exist only in `src/mcp/wire.ts`. Handlers speak `ToolOutcome` and branded paths. JSON Schema validation runs at CallTool entry; interior code trusts domain types. per boundary-discipline.

**Reuse without dual skills.** Lift sibling `session/`, `contract/`, `analysis/`, and tool handlers into the MCP process, retargeting results from Pi `AgentToolResult` to `ToolOutcome`. Import main `skills/reverse-engineer-anything` format parsers as libraries for JS/artifact/binary/Go/HAR families not yet in the sibling. Ship one bundled skill whose tool names are `mcp__rea__*`. Delete the sibling's "no MCP SDK / no registerMcpServer" independence rule; replace it with "no rea-agents at runtime." per laziness-protocol (reuse kernel), migrate-callers then delete legacy registration shape in one wave when implementing.

**Shared state.** Session ledgers live only in the MCP child. The extension host holds none. Two Pi sessions mean two connections and two processes; no cross-process ledger merge. Export/import is the merge-at-read-boundary path. Tool execution inside one process stays single-writer (MCP request serialization + sequential handler discipline). per separate-before-serializing-shared-state, make-operations-idempotent (`closeTarget` and reconnect both converge to empty session).

**Interface depth.** Public surface the maintainer and agent learn is small: install package, server name `rea`, call `mcp__rea__*`, follow the skill, `/rea` for status. Hidden behind that. Catalog generation against the oracle, fail-closed unimplemented matrix, Evidence identity, availability groups, prompt templates, stdio lifecycle, analyzer adapters, response budget, independence tests. Callers do not coordinate registration, schema loading, or ledger ownership. That is the depth argument for MCP over a flatter `registerTool` loop. The cost is real. Process hop, cold start on session connect, Evidence lifetime coupled to MCP connection rather than extension `session_start` alone, Pi 1.4.0 not surfacing MCP prompts as slash commands (skill carries workflow prose; prompts still implemented for protocol/oracle parity), and `mcp.json` name collisions overriding the extension. Argue those as accepted tradeoffs, not surprises.

**Deliberate non-goals.** No second agent loop. No provider bridges pretended into existence. No writing `mcp.json` from the extension (registration is session-scoped per Pi docs). No re-export of MCP SDK types from the package public API.

**Call chains.** Host → registerMcpServer; MCP wire → dispatchTool → handler → session/analyzer. Three hops max for a tool call inside our code. per minimize-reader-load, laziness-protocol.

**Invariants encoded in structure.** Server name branded as `"rea"`. Catalog counts fixed at 229/6 in the type. `SessionPhase` excludes open-without-target. Unimplemented tools are absent from `HandlerRegistry` and resolve to `capability_unavailable` in dispatch, not ad hoc switches scattered in handlers. Oracle digests live on `ToolCatalog.oracle` and are what doctor compares. per encode-lessons-in-structure.

## Synthesis decision

Synthesis TBD.

## Tradeoffs accepted

- We accept a stdio process boundary and startup latency in exchange for `mcp__rea__*` parity with official Pi setup and a reusable MCP server other clients can attach to the same way.
- We accept that Pi 1.4.0 does not expose MCP prompts as first-class agent slash commands in exchange for still implementing `prompts/list` + `prompts/get` for oracle/protocol parity, with workflows duplicated in the skill.
- We accept an `@modelcontextprotocol/sdk` dependency in exchange for zero `rea-agents` dependency and a real tools/list surface.
- We accept Evidence loss on MCP reconnect (`/new`, `/resume`, `/fork`) in exchange for never sharing ledger writes across actors; export/import is the continuity path (same discipline as sibling, now enforced by process lifetime).
- We accept deferred exposure for most of 229 tools in exchange for keeping the default prompt small (Pi-native depth criterion).
- We accept rewriting the sibling independence test (it currently bans MCP) in exchange for the forced clean-room MCP shape.
- We accept not offering a true in-process MCP transport in exchange for using only public Pi 1.4.0 APIs (`registerMcpServer` stdio).

## Alternatives considered

- **Pi `registerTool` for all 229 tools (sibling shape).** Hides process and wire complexity and keeps session in the extension host. Loses official `mcp__rea__*` discovery, MCP prompts protocol surface, and drop-in verify scripts that assume MCP. Shallower toward the official Pi client contract even though the host API feels simpler. Rejected for this candidate's forced direction; remains the main contender for other arena runners.
- **Extension writes `~/.pi/agent/mcp.json` pointing at our bin (or at `npx rea-agents`).** Matches setup docs' file shape but either depends on `rea-agents` or mutates user config from an extension. Pi already gives `registerMcpServer` for session-scoped registration without file writes. Rejected. per experience-first and independence.
- **HTTP MCP server inside the extension.** `registerMcpServer` allows URL configs, but we would own a loopback server lifecycle, auth surface, and port contention for no gain over stdio for a local clean-room. Rejected as extra shared-state and ops complexity.
- **Hybrid. Kernel via `registerTool`, long tail via MCP.** Two naming schemes (`binary_session` vs `mcp__rea__binary_session`) split the skill and break a single oracle verify. Information leakage of "which tools are native." Rejected as shallow and leaky per design-red-flags.

## Open questions and risks

- Does Pi reconnect the extension-registered stdio server on every `/new`, and is that process-kill or warm reconnect? Measure before relying on Evidence lifetime claims.
- Should kernel `toolExposure: direct` wait cost (10s first prompt) stay, or should everything stay deferred and force `tool_search` from day one?
- Are 6.8.0 prompt argument schemas and message bodies stable enough to freeze in `schemas/prompts.json`, or do we only freeze names/args from `prompts/list` and author message text ourselves (same interface-facts boundary as tool descriptions)?
- How far can main skill parsers be imported without dragging skill CLI assumptions (store-on-disk vs MCP Evidence ledger) into the server?
- When a user already has `mcp.json` `rea` from official setup, do we detect override in `/rea` and tell them which server won?
- Response budget. Sibling mirrors `REA_MCP_MAX_RESPONSE_BYTES` at 10 MiB. Keep the same env name for agent familiarity, or rename to `PI_REA_*` to avoid implying rea-agents?

## Next implementation step

Regenerate `schemas/tool-contracts.json` and `schemas/prompts.json` from the 6.8.0 oracle digests, then implement `bin/rea-mcp.mjs` + `createMcpRuntime` so a standalone `tools/list` matches 229 names before wiring `registerReaMcpServer`.
