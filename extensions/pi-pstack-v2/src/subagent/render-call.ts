import type { Theme } from '@earendil-works/pi-coding-agent';
import { Text } from '@earendil-works/pi-tui';
import type { AgentScope } from './agents.ts';
import { clip } from './format.ts';
import { type SubagentParamsType, toAgentScope, type WorkItem } from './schema.ts';

type PreviewItem = Pick<WorkItem, 'agent' | 'task'>;

const PREVIEW_ITEMS = 3;
const ITEM_PREVIEW_CHARS = 40;
const SINGLE_PREVIEW_CHARS = 60;

const heading = (theme: Theme, label: string, scope: AgentScope): string => theme.fg('toolTitle', theme.bold('subagent ')) + theme.fg('accent', label) + theme.fg('muted', ` [${scope}]`);

const moreLine = (theme: Theme, total: number): string[] => (total > PREVIEW_ITEMS ? [`  ${theme.fg('muted', `... +${total - PREVIEW_ITEMS} more`)}`] : []);

/** The call's heading, its first few items and a count of the rest. A chain numbers its steps and drops `{previous}` from their tasks. */
function groupLines(theme: Theme, items: PreviewItem[], label: string, scope: AgentScope, numbered: boolean): string[] {
  const rows = items.slice(0, PREVIEW_ITEMS).map((item, i) => {
    const task = numbered ? item.task.replace(/\{previous\}/g, '').trim() : item.task;
    const number = numbered ? `${theme.fg('muted', `${i + 1}.`)} ` : '';
    return `  ${number}${theme.fg('accent', item.agent)}${theme.fg('dim', ` ${clip(task, ITEM_PREVIEW_CHARS)}`)}`;
  });
  return [heading(theme, label, scope), ...rows, ...moreLine(theme, items.length)];
}

export function renderSubagentCall(args: SubagentParamsType, theme: Theme): Text {
  const scope = toAgentScope(args.agentScope);
  if (args.chain && args.chain.length > 0) return new Text(groupLines(theme, args.chain, `chain (${args.chain.length} steps)`, scope, true).join('\n'), 0, 0);
  if (args.tasks && args.tasks.length > 0) return new Text(groupLines(theme, args.tasks, `parallel (${args.tasks.length} tasks)`, scope, false).join('\n'), 0, 0);
  const preview = args.task ? clip(args.task, SINGLE_PREVIEW_CHARS) : '...';
  return new Text(`${heading(theme, args.agent || '...', scope)}\n  ${theme.fg('dim', preview)}`, 0, 0);
}
