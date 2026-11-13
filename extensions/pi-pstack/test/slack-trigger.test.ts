import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { pollSlack } from '../src/slack/trigger.ts';

interface FakeMessage {
  ts: string;
  thread_ts?: string;
  text: string;
  reply_count?: number;
  latest_reply?: string;
}

function page(messages: FakeMessage[], body: Record<string, unknown>) {
  const start = Number(body['cursor'] ?? 0);
  const limit = Number(body['limit'] ?? 100);
  const next = start + limit < messages.length ? String(start + limit) : '';
  return { ok: true, messages: messages.slice(start, start + limit), has_more: next !== '', response_metadata: { next_cursor: next } };
}

function fakeSlack(channel: FakeMessage[]) {
  vi.stubGlobal('fetch', async (url: URL, init: RequestInit) => {
    const method = url.pathname.split('/').at(-1);
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    const after = (ts: string) => body['oldest'] === undefined || Number(ts) > Number(body['oldest']);
    const topLevel = channel.filter((m) => m.thread_ts === undefined || m.thread_ts === m.ts);
    const sorted = (list: FakeMessage[]) => list.filter((m) => after(m.ts)).toSorted((a, b) => Number(b.ts) - Number(a.ts));
    if (method === 'conversations.history') return Response.json(page(sorted(topLevel), body));
    if (method === 'conversations.replies') return Response.json(page(sorted(channel.filter((m) => m.thread_ts === body['ts'])).toReversed(), body));
    return Response.json({ ok: false, error: 'unknown_method' });
  });
}

beforeEach(() => {
  vi.stubEnv('SLACK_BOT_TOKEN', 'xoxb-test');
  vi.stubEnv('PSTACK_SLACK_API_URL', 'http://slack.test/api/');
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

test('a history that repeats its page cursor fails the poll instead of reading forever', async () => {
  vi.stubGlobal('fetch', async () => Response.json({ ok: true, messages: [{ ts: '1000.000000', text: 'again' }], response_metadata: { next_cursor: 'same' } }));
  await expect(pollSlack({ channel: 'C1' }, { ts: '999', replyTs: '999' })).rejects.toThrow('Slack conversations.history failed: repeated page cursor');
});

test('every message posted since the read position fires, across history pages', async () => {
  fakeSlack(Array.from({ length: 250 }, (_, i) => ({ ts: `${1000 + i}.000000`, text: `report ${i}` })));
  const { fires, cursor } = await pollSlack({ channel: 'C1' }, { ts: '999', replyTs: '999' });
  expect(fires.map((fire) => fire.message.text)).toEqual(Array.from({ length: 250 }, (_, i) => `report ${i}`));
  expect(cursor.ts).toBe('1249.000000');
});
