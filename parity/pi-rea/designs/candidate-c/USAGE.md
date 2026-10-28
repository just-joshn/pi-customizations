# pi-rea (candidate C). Single CLI kernel + thin Pi adapters

Claimable 100% agent-facing parity with rea-agents 6.8.0 on Pi 1.4.0, with zero runtime dependency on rea-agents. One Node CLI owns Evidence, session, and analyzers. Pi tools, the skill, and prompts are thin surfaces over that CLI.

## Install

Ship as one Pi package under `extensions/pi-rea`. The package carries the kernel binary (`rea`), generated tool registration, skill, and prompts. Oracle captures under `parity/pi-rea/` stay verification-only.

```bash
# From a Pi project that loads the package
pi  # extension factory registers tools; skill and prompts load via DefaultResourceLoader
```

Human and script callers use the same kernel the model reaches through tools.

```bash
rea capabilities --json
rea route ./Target.app
rea analyze-javascript-application ./Target.app --json
rea inspect-macho --store .rea --json   # after open / with bound subject
rea discipline-audit --json
rea evidence-export ./bundle.json --stable
```

## Mental model

1. **Contract file is the catalog SSOT.** `schemas/tool-contracts.json` lists all 229 operations (names, parameters, annotations, effects, implementation status). Adding a capability means adding or promoting a kernel command against that file first.
2. **Kernel is the only place Evidence is written.** Every implemented operation retains an envelope (or fails closed) before it reports. Content-addressed store under `--store` (default `.rea`).
3. **Pi adapters do not reimplement analysis.** Each `pi.registerTool` execute path maps args to one kernel invoke and maps the JSON envelope or error back to Pi `content` / `structuredContent` / `details`.
4. **Pi owns the agent loop.** The extension never starts a second loop, MCP server, or parallel in-memory ledger. Session bind is `session_start` → store root for `ctx.cwd`.

## Quickstart (model path)

Direct tools stay small. The rest of the 229-tool catalog is `deferred` and reached through Pi `tool_search` or codemode.

```text
1. binary_session          → availability + identity check
2. open_binary / route     → bind local target (kernel session)
3. inspect_* / analyze_*   → retain Evidence
4. record_unknown …        → residual questions
5. export_evidence_bundle  → portable bundle
6. close_binary            → clear session store binding
```

Unavailable operations still register. They invoke a kernel stub that returns `capability_unavailable` with a stable reason code. That answer is a coverage gap, never a finding about the target.

## Call site 1. Extension factory (Pi)

```ts
// extensions/pi-rea/index.ts  (thin)
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { bindStore, registerGeneratedTools } from './adapter/register.ts';

export default function piRea(pi: ExtensionAPI): void {
  let storeRoot: string | undefined;

  pi.on('session_start', (_e, ctx) => {
    storeRoot = bindStore(ctx.cwd); // resolves <cwd>/.rea; idempotent
  });
  pi.on('session_shutdown', async () => {
    storeRoot = undefined; // kernel close is explicit via close_binary tool
  });

  registerGeneratedTools(pi, {
    getStoreRoot: () => storeRoot ?? bindStore(process.cwd()),
    // invoke uses the same runner as `rea` argv; no second stack
  });

  pi.registerCommand('rea', {
    description: 'Show kernel store status for this Pi session',
    handler: async (_args, ctx) => {
      const report = await invokeKernel({
        operation: 'binary_session',
        args: {},
        storeRoot: storeRoot ?? bindStore(ctx.cwd),
        signal: undefined,
      });
      ctx.ui.notify(formatStatus(report), 'info');
    },
  });
}
```

## Call site 2. Generated tool execute (Pi → kernel)

```ts
// Generated once per contract entry. Direct for kernel-implemented ops;
// deferred for the rest. executionMode: "sequential" for store writers.
async function executeInspectPlist(
  _id: string,
  params: { path?: string; /* contract fields */ },
  signal: AbortSignal | undefined,
  _onUpdate: unknown,
  ctx: { cwd: string },
): Promise<AgentToolResult<unknown>> {
  const result = await invokeKernel({
    operation: 'inspect_plist',
    args: params,
    storeRoot: bindStore(ctx.cwd),
    signal,
  });
  return toPiToolResult(result); // parses kernel JSON → content + structuredContent
}
```

## Call site 3. Kernel CLI / programmatic runner (SSOT)

```ts
// Same entry human scripts and adapters share
const out = await runCommand({
  argv: ['inspect-binary-layout', '/path/to/bin', '--json'],
  storeDir: '.rea',
  cwd: process.cwd(),
  signal,
});
// out.ok ? envelope : errorEnvelope  — identical shape on stdout as --json
```

Catalog growth path for a maintainer.

```text
1. Edit schemas/tool-contracts.json (mark implementation: kernel | unavailable)
2. Implement kernel command module under kernel/lib/… (or leave stub)
3. Run generate-catalog (regen CLI table + adapter/register.ts)
4. Add/adjust skill prompt text only if routing guidance changes
5. Parity: replay oracle fixture for that operation
```

## What this design deliberately is not

- **Not pure registerTool-only.** Analysis, ledgers, and format parsers do not live as a second TypeScript stack inside the extension. Sibling `session/` and `analysis/` code is absorbed into kernel modules, then deleted as a parallel tree.
- **Not an MCP server.** No `pi.registerMcpServer`, no tools/list proxy, no rea-agents npx. Pi sees native `registerTool` entries generated from the same contract the CLI uses.
- **Not a rea-agents wrapper.** Oracle JSON under `parity/pi-rea/` judges parity. Runtime never imports or spawns rea-agents.
