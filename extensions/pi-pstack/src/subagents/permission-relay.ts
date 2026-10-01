import type { RpcChild, RpcRecord } from './rpc-child.ts';

export const permissionTitlePrefix = 'pstack-permission:';
const readOnlyTools = new Set(['read', 'grep', 'find', 'ls']);
const editTools = new Set(['edit', 'write']);
const unattendedModes = new Set(['bypassPermissions', 'dontAsk', 'auto']);
const bodyLimit = 2000;

export type ToolPolicy = Readonly<{ tools: readonly string[]; approve: readonly string[] }>;

/** Splits the allowed tools into those the child may run and those it must ask the parent about first. */
export function childToolPolicy(allowed: readonly string[], mode: string | undefined): ToolPolicy {
  if (mode === 'plan') return { tools: allowed.filter((tool) => readOnlyTools.has(tool)), approve: [] };
  if (mode !== undefined && unattendedModes.has(mode)) return { tools: allowed, approve: [] };
  const mutating = allowed.filter((tool) => !readOnlyTools.has(tool));
  return { tools: allowed, approve: mode === 'acceptEdits' ? mutating.filter((tool) => !editTools.has(tool)) : mutating };
}

export function permissionTitle(tool: string): string {
  return `${permissionTitlePrefix}${tool}`;
}

export function permissionBody(tool: string, input: unknown): string {
  return `${tool} ${JSON.stringify(input) ?? ''}`.slice(0, bodyLimit);
}

export function requestedTool(title: unknown): string | undefined {
  return typeof title === 'string' && title.startsWith(permissionTitlePrefix) ? title.slice(permissionTitlePrefix.length) : undefined;
}

export type RelayDeps = Readonly<{
  label: string;
  allowedToolNames: ReadonlySet<string>;
  ask: (title: string, body: string) => Promise<boolean>;
}>;

const dialogMethods = new Set(['select', 'confirm', 'input', 'editor']);

/** Answers one extension-UI record from a child. Only permission asks for allowed tools reach the parent. */
export async function relayUiRequest(child: Pick<RpcChild, 'respond'>, record: RpcRecord, deps: RelayDeps): Promise<void> {
  const id = typeof record.id === 'string' ? record.id : undefined;
  const method = typeof record.method === 'string' ? record.method : undefined;
  if (!id || !method || !dialogMethods.has(method)) return;
  const tool = requestedTool(record.title);
  if (tool === undefined || !deps.allowedToolNames.has(tool)) {
    child.respond(id, { cancelled: true });
    return;
  }
  const body = typeof record.message === 'string' ? record.message : '';
  const confirmed = await deps.ask(`${deps.label} wants to use ${tool}`, body).catch(() => false);
  child.respond(id, { confirmed });
}
