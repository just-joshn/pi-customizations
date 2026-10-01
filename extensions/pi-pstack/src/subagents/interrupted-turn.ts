import { SessionManager } from '@earendil-works/pi-coding-agent';

export function completedAnswer(sessionFile: string): string | undefined {
  const last = SessionManager.open(sessionFile).buildSessionContext().messages.at(-1);
  if (last?.role !== 'assistant' || last.stopReason !== 'stop') return undefined;
  if (last.content.some((part) => part.type === 'toolCall')) return undefined;
  return last.content.flatMap((part) => (part.type === 'text' ? [part.text] : [])).join('');
}
