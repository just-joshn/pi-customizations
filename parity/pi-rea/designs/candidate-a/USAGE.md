# pi-rea (candidate A)

Clean-room REA 6.8.0 for Pi 1.4.0 as a **Pi package** of native tools. The extension regenerates its contract from `parity/pi-rea/rea-6.8.0-tools-list.json` (229 tools), registers every tool with `pi.registerTool`, declares the session and Evidence kernel as `direct`, and parks the rest as `deferred` for `tool_search` / codemode. It ships one skill and six prompt templates. It never imports, spawns, or npx's `rea-agents`.

## Install

```sh
pi install ./extensions/pi-rea
# or one-shot
pi -e ./extensions/pi-rea --tools +tool_search
```

The package declares `extensions`, `skills`, and `prompts` in its `pi` manifest. After install, Pi loads the extension factory, the `reverse-engineer-anything` skill, and the six REA prompt templates.

## What you use day to day

You do not import TypeScript from this package in application code. The consumers are the Pi agent (model + tools), a human at the `/` menu, and maintainers regenerating contracts.

| Surface | How you reach it |
| --- | --- |
| Kernel tools (`binary_session`, `open_binary`, Evidence / unknowns, shipped inspectors) | Declared to the model (`exposure: "direct"`) |
| Remaining catalog (up to 229) | Registered `deferred`; discover with `tool_search` or call from codemode |
| Workflow skill | Auto-loaded skill `reverse-engineer-anything` |
| Six REA prompts | Prompt templates (same names as REA MCP prompts) |
| Session status | `/rea` |
| Contract regen | `npm run generate:contracts` inside the package |

Unimplemented capabilities answer `capability_unavailable` and never invent findings. Coverage gaps stay gaps.

## Typical investigation (agent)

1. Load the skill or run `/investigate_feature`.
2. Call `binary_session` for availability, open target, and catalog digests.
3. Call `open_binary` with a local path.
4. Call kernel inspectors or `tool_search` for deferred family tools.
5. Keep residuals with `record_unknown` / `list_unknowns`.
6. `export_evidence_bundle` before `close_binary` (close clears session state).

## Call site 1. Extension factory (Pi loads this)

```ts
// extensions/pi-rea/src/index.ts
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createSessionHolder } from "./session/rea-session.ts";
import { registerAllTools } from "./registry.ts";

export default function piRea(pi: ExtensionAPI): void {
  const holder = createSessionHolder();

  pi.on("session_start", (_event, ctx) => {
    holder.reset(ctx.cwd);
  });

  pi.on("session_shutdown", () => {
    holder.shutdown(); // idempotent: clear target + ledgers even if never opened
  });

  pi.registerCommand("rea", {
    description: "Show pi-rea target, availability, and Evidence counts",
    handler: async (_args, ctx) => {
      ctx.ui.notify(holder.current().statusLines().join("\n"), "info");
    },
  });

  registerAllTools(pi, () => holder.current());
}
```

## Call site 2. Contract generator (maintainer regenerates from the 6.8.0 oracle)

```ts
// scripts/generate-contracts.ts (run via package script; not a Pi tool)
import { readFileSync, writeFileSync } from "node:fs";
import { generateCatalog } from "../src/catalog/generate.ts";

const oracle = JSON.parse(
  readFileSync("../../parity/pi-rea/rea-6.8.0-tools-list.json", "utf8"),
);
const kernel = JSON.parse(readFileSync("./schemas/kernel-manifest.json", "utf8"));

const catalog = generateCatalog(oracle, kernel);
writeFileSync("./schemas/tool-contracts.json", JSON.stringify(catalog, null, 2));
// verify: catalog.counts.tools === 229 and tools_sha256 matches binary_session digests
```

## Call site 3. Family handler (implement one tool family without touching registration)

```ts
// src/families/static-inspectors.ts
import type { FamilyHandlers } from "../dispatch.ts";
import { capabilityUnavailable } from "../contract/errors.ts";
import { inspectPlist } from "../analysis/plist.ts";

export const staticInspectorsHandlers: FamilyHandlers = {
  inspect_plist: async (session, params, ctx) => inspectPlist(session, params, ctx),
  inspect_macho: async (session, params, ctx) => {
    // absorbed from sibling analysis; still not implemented in this sketch
    throw new Error("not implemented");
  },
  // every other name in this family falls through to fail-closed
  fallback: (name) => {
    throw capabilityUnavailable(
      `pi-rea advertises ${name} but has not implemented it yet.`,
      { operation: name, reason: "not_implemented" },
    );
  },
};
```

Registration stays a single loop over the generated catalog. Adding `inspect_go_binary` means writing a handler and flipping that name to `kernel` or leaving it `deferred` until it earns a direct slot. No second registry, no MCP server, no rea-agents process.
