// What watching a Slack thread for people needs: Slack timestamps compared as numbers, the messages a person wrote after a
// point in time, and JSON that cannot close the fence it sits in.
import type { ThreadMessage } from './outbox.ts';

/** Slack timestamps are `<seconds>.<microseconds>`; compared as integers they need no float rounding. */
export const after = (left: string, right: string) => BigInt(left.replace('.', '')) > BigInt(right.replace('.', ''));

/** JSON whose `<` is escaped, so untrusted text cannot close the fence around it; it still parses to the same value. */
export const fenced = (value: unknown) => JSON.stringify(value, null, 2).replace(/</g, '\\u003c');

/** A message of the thread by a person: not the root, not marked as one of the parent's own posts, and not the triage identity. */
export function humanMessagesAfter(thread: readonly ThreadMessage[], seenTs: string, rootTs: string, triageIdentityUserId: string | undefined): ThreadMessage[] {
  return thread.filter((message) => message.ts !== rootTs && after(message.ts, seenTs) && message.marker === undefined && message.user !== undefined && message.user !== '' && message.user !== triageIdentityUserId);
}

export const latestTs = (messages: readonly { ts: string }[], fallback: string) => messages.reduce((latest, message) => (after(message.ts, latest) ? message.ts : latest), fallback);
