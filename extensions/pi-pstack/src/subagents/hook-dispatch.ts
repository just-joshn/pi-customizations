import { type HookRun, runCommandHooks } from './hook-run.ts';
import { type CommandHook, type HookEventName, type HookGroup, type HookTable, matchesHook, parseAgentHooks } from './hook-table.ts';
import { readSettingsLayers, type SettingsRoots } from './settings-layers.ts';

export const hookEventChannel = 'pstack:hook-event';

export type HookBase = Readonly<{ session_id: string; transcript_path?: string; cwd: string }>;
export type HookEventPayload = Readonly<{
  hook_event_name: HookEventName;
  agent_id?: string;
  agent_type?: string;
  tool_name?: string;
  hooks: readonly Readonly<{ command: string; exit_code: number }>[];
  outcome: 'success' | 'blocked' | 'error';
}>;
export type HookRequest = Readonly<{
  event: HookEventName;
  subject: string;
  agentId?: string;
  agentType?: string;
  toolName?: string;
  base: HookBase;
  input?: Readonly<Record<string, unknown>>;
  settings: HookTable;
  agentHooks?: boolean;
  timeoutCapMs?: number;
}>;

function mergeTables(tables: readonly HookTable[]): HookTable {
  const merged: Partial<Record<HookEventName, HookGroup[]>> = {};
  for (const table of tables) {
    for (const [event, groups] of Object.entries(table) as [HookEventName, readonly HookGroup[]][]) merged[event] = [...(merged[event] ?? []), ...groups];
  }
  return merged;
}

export async function loadSettingsHooks(roots: SettingsRoots, projectTrusted: boolean, log: (message: string) => void): Promise<HookTable> {
  const layers = await readSettingsLayers(roots);
  const tables = [...layers.user, ...(projectTrusted ? layers.project : [])].map((settings) => {
    const { Stop: _parentStop, ...hooks } = (typeof settings.hooks === 'object' && settings.hooks !== null ? settings.hooks : {}) as Record<string, unknown>;
    const parsed = parseAgentHooks({ hooks }, 'settings');
    if (parsed.unloadable) log(`Ignoring settings hooks: ${parsed.unloadable}`);
    return parsed.hooks ?? {};
  });
  return mergeTables(tables);
}

function matching(table: HookTable | undefined, event: HookEventName, subject: string): CommandHook[] {
  return (table?.[event] ?? []).filter((group) => matchesHook(group.matcher, subject)).flatMap((group) => group.hooks);
}

function outcomeOf(event: HookEventName, runs: readonly HookRun[]): HookEventPayload['outcome'] {
  if (runs.some((run) => run.code === 2 && (event === 'PreToolUse' || event === 'PermissionRequest'))) return 'blocked';
  return runs.some((run) => run.code !== 0) ? 'error' : 'success';
}

/** Runs settings hooks and the frontmatter hooks registered for a child, and reports each firing on the shared event channel. */
export class HookDispatcher {
  private registered: ReadonlyMap<string, HookTable> = new Map();

  constructor(private readonly publish: (payload: HookEventPayload) => void) {}

  register(agentId: string, table: HookTable | undefined): void {
    if (table) this.registered = new Map([...this.registered, [agentId, table]]);
  }

  release(agentId: string): void {
    this.registered = new Map([...this.registered].filter(([id]) => id !== agentId));
  }

  has(agentId: string): boolean {
    return this.registered.has(agentId);
  }

  async fire(request: HookRequest): Promise<HookRun[]> {
    const own = request.agentHooks === false || request.agentId === undefined ? undefined : this.registered.get(request.agentId);
    const hooks = [...matching(request.settings, request.event, request.subject), ...matching(own, request.event, request.subject)];
    if (hooks.length === 0) return [];
    const input = { ...request.base, hook_event_name: request.event, ...request.input };
    const runs = await runCommandHooks(hooks, input, { cwd: request.base.cwd, ...(request.timeoutCapMs ? { timeoutCapMs: request.timeoutCapMs } : {}) });
    this.publish({
      hook_event_name: request.event,
      ...(request.agentId ? { agent_id: request.agentId } : {}),
      ...(request.agentType ? { agent_type: request.agentType } : {}),
      ...(request.toolName ? { tool_name: request.toolName } : {}),
      hooks: runs.map((run) => ({ command: run.command, exit_code: run.code })),
      outcome: outcomeOf(request.event, runs),
    });
    return runs;
  }
}
