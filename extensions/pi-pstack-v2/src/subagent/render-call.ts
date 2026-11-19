import type { Theme } from '@earendil-works/pi-coding-agent';
import { Text } from '@earendil-works/pi-tui';
import type { AgentScope } from './agents.ts';
import { type SubagentParamsType, toAgentScope, type WorkItem } from './schema.ts';

const PREVIEW_ITEMS = 3;
const ITEM_PREVIEW_CHARS = 40;
const SINGLE_PREVIEW_CHARS = 60;

const clip = (text: string, max: number): string => (text.length > max ? `${text.slice(0, max)}...` : text);

const heading = (theme: Theme, label: string, scope: AgentScope): string => theme.fg('toolTitle', theme.bold('subagent ')) + theme.fg('accent', label) + theme.fg('muted', ` [${scope}]`);

const moreLine = (theme: Theme, total: number): string[] => (total > PREVIEW_ITEMS ? [`  ${theme.fg('muted', `... +${total - PREVIEW_ITEMS} more`)}`] : []);

function chainLines(theme: Theme, chain: WorkItem[], scope: AgentScope): string[] {
  const steps = chain.slice(0, PREVIEW_ITEMS).map((step, i) => {
    const cleanTask = step.task.replace(/\{previous\}/g, '').trim();
    return `  ${theme.fg('muted', `${i + 1}.`)} ${theme.fg('accent', step.agent)}${theme.fg('dim', ` ${clip(cleanTask, ITEM_PREVIEW_CHARS)}`)}`;
  });
  return [heading(theme, `chain (${chain.length} steps)`, scope), ...steps, ...moreLine(theme, chain.length)];
}

function parallelLines(theme: Theme, tasks: WorkItem[], scope: AgentScope): string[] {
  const rows = tasks.slice(0, PREVIEW_ITEMS).map((t) => `  ${theme.fg('accent', t.agent)}${theme.fg('dim', ` ${clip(t.task, ITEM_PREVIEW_CHARS)}`)}`);
  return [heading(theme, `parallel (${tasks.length} tasks)`, scope), ...rows, ...moreLine(theme, tasks.length)];
}

export function renderSubagentCall(args: SubagentParamsType, theme: Theme): Text {
  const scope = toAgentScope(args.agentScope);
  if (args.chain && args.chain.length > 0) return new Text(chainLines(theme, args.chain, scope).join('\n'), 0, 0);
  if (args.tasks && args.tasks.length > 0) return new Text(parallelLines(theme, args.tasks, scope).join('\n'), 0, 0);
  const preview = args.task ? clip(args.task, SINGLE_PREVIEW_CHARS) : '...';
  return new Text(`${heading(theme, args.agent || '...', scope)}\n  ${theme.fg('dim', preview)}`, 0, 0);
}
