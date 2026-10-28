# pi-rea (MCP clean-room)

REA's Pi client contract as a Pi package. An extension registers an in-repo MCP stdio server named `rea`. Pi discovers tools as `mcp__rea__*`, the same names official `rea setup --client pi` writes into `mcp.json`. A bundled `reverse-engineer-anything` skill teaches the investigation workflow. There is no runtime dependency on the `rea-agents` package.

## Install

```sh
pi install ./extensions/pi-rea
```

Development load without install:

```sh
pi -e ./extensions/pi-rea/src/index.ts
```

On load the extension calls `pi.registerMcpServer("rea", …)` with a stdio command that runs this package's own MCP entry (`node …/bin/rea-mcp.mjs`). It does not write `mcp.json`. A user-level or project `mcp.json` entry named `rea` overrides the registration; do not also run official `rea setup --client pi` for the same client.

Large catalog stays off the default prompt. Prefer deferred exposure plus `tool_search`, or codemode:

```sh
pi --tools +tool_search
# or
pi --tools +codemode
```

Kernel tools (`binary_session`, `open_binary`, `close_binary`, Evidence and unknown tools) may be marked `direct` via `toolExposure` so the first prompt waits for them.

## What the agent sees

| Surface | Shape |
| --- | --- |
| Tools | `mcp__rea__binary_session`, `mcp__rea__open_binary`, … (229 tools from the 6.8.0 oracle) |
| Prompts | MCP `prompts/list` advertises 6 prompts (`investigate_feature`, `compare_application_versions`, `verify_reconstruction`, `trace_crash`, `audit_residual_unknowns`, `prepare_bounded_process_capture`). Pi 1.4.0 does not wire MCP prompts into slash commands; the skill encodes the same workflows in prose. |
| Skill | `reverse-engineer-anything` (one copy; absorbs sibling + main skill intent) |
| Status | `/rea` prints target, availability counts, Evidence size (calls `binary_session` over the live MCP connection when connected) |

## Call sites

### 1. Extension factory (only registration callers need)

```ts
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerReaMcpServer, registerReaCommand } from "./host.ts";

export default function piRea(pi: ExtensionAPI): void {
  registerReaMcpServer(pi);
  registerReaCommand(pi);
}
```

`registerReaMcpServer` resolves the package-local stdio entry, registers server name `rea`, sets `description`, default `exposure: "deferred"`, and `toolExposure` for the kernel set. It never imports `rea-agents`.

### 2. Agent investigation (tools as the agent calls them)

```text
Call mcp__rea__binary_session to see availability.
Call mcp__rea__open_binary with path /usr/local/bin/thing.
Call mcp__rea__inspect_macho (or another direct analyzer).
Call mcp__rea__record_unknown for each residual question.
Call mcp__rea__export_evidence_bundle before mcp__rea__close_binary.
```

Codemode equivalent:

```js
const session = await mcp__rea__binary_session({});
const opened = await mcp__rea__open_binary({ path: "/usr/local/bin/thing" });
const macho = await mcp__rea__inspect_macho({});
```

Every unimplemented capability returns the canonical `capability_unavailable` error envelope. That is a coverage gap, never a finding about the target.

### 3. MCP server process (own process; Pi is the client)

```ts
// bin/rea-mcp.mjs → src/mcp/server.ts
const runtime = await createMcpRuntime({ cwd: process.cwd(), env: process.env });
await runtime.listenStdio();
```

The MCP process owns `ReaSession` (active target, Evidence ledger, unknown ledger). Analyzers from the sibling extension and engine-free parsers from `skills/reverse-engineer-anything` run behind the tool boundary. The Pi extension host holds no session state.

## Verify against the oracle

Parity checks use `parity/pi-rea/rea-6.8.0-tools-list.json` (229 tools) and the prompts digest from `binary_session`'s `server_identity.catalog`. A live `tools/list` from this server must match names and input schemas. `server_identity.package.name` reports `pi-rea`, not `rea-agents`. Doctor/independence greps forbid `rea-agents`, `npx rea-agents`, and imports from that package; `@modelcontextprotocol/sdk` is allowed.
