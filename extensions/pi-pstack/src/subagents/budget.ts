import type { SessionEntry } from '@earendil-works/pi-coding-agent';

type Costed = { usage?: { cost?: { total?: number } } };

function costOf(value: Costed | undefined): number {
  const total = value?.usage?.cost?.total;
  return typeof total === 'number' && Number.isFinite(total) ? total : 0;
}

function entryCost(entry: SessionEntry): number {
  if (entry.type === 'usage' || entry.type === 'compaction' || entry.type === 'branch_summary') return costOf(entry as Costed);
  if (entry.type !== 'message') return 0;
  const { message } = entry;
  return message.role === 'assistant' || message.role === 'toolResult' ? costOf(message as Costed) : 0;
}

export function sessionCostUsd(entries: readonly SessionEntry[]): number {
  return entries.reduce((sum, entry) => sum + entryCost(entry), 0);
}

export function maxBudgetUsd(flag: unknown): number | undefined {
  if (typeof flag !== 'string' || !flag.trim()) return undefined;
  const value = Number(flag);
  return Number.isFinite(value) && value > 0 ? value : undefined;
}
