import type { SessionManager } from '@earendil-works/pi-coding-agent';

type Entry = ReturnType<SessionManager['getBranch']>[number];
type IntentMessage = Readonly<{ customType: string; content: Parameters<SessionManager['appendCustomMessageEntry']>[1] }>;

const intentTypes: ReadonlySet<string> = new Set(['plan-mode-context']);

/** The latest hidden message of each parent intent type that an ordinary child must see, such as Pi's plan mode. */
export function parentIntent(branch: readonly Entry[]): IntentMessage[] {
  const latest = new Map<string, IntentMessage>();
  for (const entry of branch) if (entry.type === 'custom_message' && intentTypes.has(entry.customType)) latest.set(entry.customType, { customType: entry.customType, content: entry.content });
  return [...latest.values()];
}

export function seedParentIntent(manager: SessionManager, branch: readonly Entry[]): void {
  for (const message of parentIntent(branch)) manager.appendCustomMessageEntry(message.customType, message.content, false);
}
