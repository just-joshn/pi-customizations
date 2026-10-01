import type { AgentToolResult, ExtensionAPI, Theme, ToolRenderResultOptions } from '@earendil-works/pi-coding-agent';
import { type Component, Text } from '@earendil-works/pi-tui';

type AgentCallArgs = Readonly<{ description?: string; prompt?: string; subagent_type?: string }>;
type Group = { readonly ids: readonly string[]; readonly finished: Set<string>; invalidateHeader?: () => void };
type ResultDetails = Readonly<{ status?: string; agentId?: string; totalToolUseCount?: number; totalTokens?: number; content?: ReadonlyArray<{ text?: string }> }>;

export function agentDisplayName(args: AgentCallArgs): string {
  return args.subagent_type && args.subagent_type !== 'general-purpose' ? args.subagent_type : 'Agent';
}

export function agentActivity(args: AgentCallArgs): string {
  return args.description?.replace(/\s+/g, ' ').trim() || 'Running task';
}

function agentCallIds(message: unknown): string[] {
  if (message === null || typeof message !== 'object') return [];
  const { role, content } = message as { role?: unknown; content?: unknown };
  if (role !== 'assistant' || !Array.isArray(content)) return [];
  return content.flatMap((part: { type?: unknown; name?: unknown; id?: unknown }) => (part?.type === 'toolCall' && part.name === 'Agent' && typeof part.id === 'string' ? [part.id] : []));
}

// pi renders each parallel tool call in its own row, so the group is joined by tool call id across rows.
export class AgentCallGroups {
  private readonly groups = new Map<string, Group>();

  observe(message: unknown): void {
    const ids = agentCallIds(message);
    if (ids.length < 2 || this.groups.has(ids[0] ?? '')) return;
    const group: Group = { ids, finished: new Set() };
    for (const id of ids) this.groups.set(id, group);
  }

  finish(id: string): void {
    const group = this.groups.get(id);
    if (!group) return;
    group.finished.add(id);
    group.invalidateHeader?.();
  }

  clear(): void {
    this.groups.clear();
  }

  header(id: string, invalidate: () => void): string | undefined {
    const group = this.groups.get(id);
    if (!group || group.ids[0] !== id) return undefined;
    group.invalidateHeader = invalidate;
    return group.finished.size === group.ids.length ? `${group.ids.length} agents finished` : `Running ${group.ids.length} agents…`;
  }

  branch(id: string): string {
    const group = this.groups.get(id);
    if (!group) return '';
    return group.ids.at(-1) === id ? '└─ ' : '├─ ';
  }
}

export function trackAgentCallGroups(pi: ExtensionAPI): AgentCallGroups {
  const groups = new AgentCallGroups();
  pi.on('message_end', (event) => groups.observe(event.message));
  pi.on('tool_execution_end', (event) => groups.finish(event.toolCallId));
  pi.on('session_start', () => groups.clear());
  return groups;
}

export function renderAgentCall(args: AgentCallArgs, theme: Theme, context: Readonly<{ toolCallId: string; invalidate: () => void }>, groups: AgentCallGroups): Component {
  const row = `${theme.fg('muted', groups.branch(context.toolCallId))}${theme.bold(agentDisplayName(args))} ${theme.fg('muted', agentActivity(args))}`;
  const header = groups.header(context.toolCallId, context.invalidate);
  return new Text(header === undefined ? row : `${theme.bold(header)}\n${row}`, 0, 0);
}

function summary(details: ResultDetails | undefined, fallback: string): string | undefined {
  if (details?.status === 'completed') {
    const uses = details.totalToolUseCount ?? 0;
    return `Done · ${uses} tool ${uses === 1 ? 'use' : 'uses'} · ${details.totalTokens ?? 0} tokens`;
  }
  if (details?.status === 'async_launched') return `Running in the background · ${details.agentId ?? ''}`;
  return fallback.split('\n')[0];
}

export function renderAgentResult(result: AgentToolResult<unknown>, options: ToolRenderResultOptions, theme: Theme): Component {
  if (options.isPartial) return new Text(theme.fg('muted', 'Running…'), 0, 0);
  const details = result.details as ResultDetails | undefined;
  const text = result.content.map((part) => (part.type === 'text' ? part.text : '')).join('\n');
  const head = theme.fg(details?.status ? 'success' : 'error', summary(details, text) ?? '');
  const body = details?.content?.map((part) => part.text ?? '').join('\n');
  return new Text(options.expanded && body ? `${head}\n${body}` : head, 0, 0);
}
