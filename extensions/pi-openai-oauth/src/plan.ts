import { fingerprint, renderNewThreadPrompt, renderTurns, type Turn } from './transcript.ts';

/** What one Pi request sends to Codex: a prompt for a new thread, or for a thread to resume. */
export interface CodexRequest {
  readonly threadId: string | null;
  readonly prompt: string;
}

/** Maps the fingerprint of a conversation that ends in a Codex reply to the thread that wrote the reply. */
export type ThreadIndex = ReadonlyMap<string, string>;

function lastAssistantIndex(turns: readonly Turn[]): number {
  return turns.findLastIndex((turn) => turn.role === 'assistant');
}

function renderTail(tail: readonly Turn[]): string {
  return tail.length === 1 && tail[0]?.role === 'user' ? tail[0].text : renderTurns(tail);
}

/**
 * Resume the thread that wrote the conversation's last reply when the conversation is unchanged up to that reply,
 * and send only what came after it. Otherwise start a new thread with the whole conversation.
 */
export function planRequest(threads: ThreadIndex, scope: string, systemPrompt: string | undefined, turns: readonly Turn[]): CodexRequest {
  const split = lastAssistantIndex(turns) + 1;
  const tail = turns.slice(split);
  const threadId = split > 0 ? threads.get(fingerprint(scope, turns.slice(0, split))) : undefined;
  if (threadId !== undefined && tail.length > 0) {
    return { threadId, prompt: renderTail(tail) };
  }
  return { threadId: null, prompt: renderNewThreadPrompt(systemPrompt, turns) };
}
