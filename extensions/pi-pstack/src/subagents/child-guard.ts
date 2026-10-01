import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { type Static, Type } from 'typebox';
import { Check } from 'typebox/value';
import { permissionBody, permissionTitle } from './permission-relay.ts';

export const guardEnv = 'PSTACK_CHILD_GUARD';

const GuardConfig = Type.Object({ kind: Type.Union([Type.Literal('remote'), Type.Literal('teammate')]), allowed: Type.Array(Type.String()), approve: Type.Array(Type.String()) });
export type GuardConfig = Static<typeof GuardConfig>;

function readConfig(env: NodeJS.ProcessEnv): GuardConfig | undefined {
  try {
    const parsed: unknown = JSON.parse(env[guardEnv] ?? 'null');
    return Check(GuardConfig, parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

/** Runs inside a remote or teammate pi process: confines it to its allowed tools and relays permission asks to the parent over RPC. */
export default function childGuard(pi: ExtensionAPI): void {
  const config = readConfig(process.env);
  if (!config) return;
  pi.on('tool_call', async (event, ctx) => {
    if (!config.allowed.includes(event.toolName)) return { block: true, reason: `Tool '${event.toolName}' is not permitted for this ${config.kind} agent.` };
    if (!config.approve.includes(event.toolName)) return undefined;
    const approved = ctx.hasUI ? await ctx.ui.confirm(permissionTitle(event.toolName), permissionBody(event.toolName, event.input)).catch(() => false) : false;
    return approved ? undefined : { block: true, reason: `The parent session did not approve ${event.toolName}.` };
  });
}
