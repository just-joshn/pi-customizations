import { randomUUID } from 'node:crypto';

import type { TranscriptContext } from '@earendil-works/pi-ai';
import { type BillingAttribution, isRequestId, type RequestId } from './identity.ts';

type SessionState = { previousRequestId?: RequestId; promptIds: Map<number, string> };

const MAX_SESSIONS = 64;
const MAX_PROMPTS = 256;
const sessions = new Map<string, SessionState>();

function stateFor(sessionId: string | undefined): SessionState {
  const key = sessionId ?? '';
  const existing = sessions.get(key);
  if (existing !== undefined) {
    sessions.delete(key);
    sessions.set(key, existing);
    return existing;
  }
  const created: SessionState = { promptIds: new Map() };
  sessions.set(key, created);
  const oldest = sessions.keys().next().value;
  if (sessions.size > MAX_SESSIONS && oldest !== undefined) sessions.delete(oldest);
  return created;
}

export function turnIndexOf(context: TranscriptContext): number {
  return Math.max(1, context.messages.filter((message) => message.role === 'user').length);
}

export function attributionFor(sessionId: string | undefined, context: TranscriptContext): BillingAttribution {
  const state = stateFor(sessionId);
  const turnIndex = turnIndexOf(context);
  let promptId = state.promptIds.get(turnIndex);
  if (promptId === undefined) {
    promptId = randomUUID();
    state.promptIds.set(turnIndex, promptId);
    const oldest = state.promptIds.keys().next().value;
    if (state.promptIds.size > MAX_PROMPTS && oldest !== undefined) state.promptIds.delete(oldest);
  }
  return { promptId, turnIndex, ...(state.previousRequestId === undefined ? {} : { previousRequestId: state.previousRequestId }) };
}

export function rememberRequestId({ sessionId, requestId }: { sessionId: string | undefined; requestId: string | null }): void {
  if (isRequestId(requestId)) stateFor(sessionId).previousRequestId = requestId;
}
