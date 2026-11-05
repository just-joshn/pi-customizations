import { createServer, type Server } from 'node:http';

import { expect, test } from 'vitest';
import { makeSandbox, type PiEvent, type Sandbox, script, startRpc, toolEnds } from './harness.ts';

interface FakeMessage {
  ts: string;
  thread_ts?: string;
  user?: string;
  text: string;
  reply_count?: number;
  latest_reply?: string;
}

/** A Slack Web API stand-in: one channel's messages in memory, a bearer token check, and a log of every call. */
async function fakeSlack(token: string): Promise<{ server: Server; url: string; channel: FakeMessage[]; calls: { method: string; body: Record<string, unknown> }[] }> {
  const channel: FakeMessage[] = [];
  const calls: { method: string; body: Record<string, unknown> }[] = [];
  let clock = 0;
  const server = createServer((request, response) => {
    let raw = '';
    request.on('data', (chunk: Buffer) => {
      raw += chunk.toString('utf8');
    });
    request.on('end', () => {
      const method = (request.url ?? '').replace(/^\/api\//, '');
      const body = raw === '' ? {} : (JSON.parse(raw) as Record<string, unknown>);
      calls.push({ method, body });
      const reply = (value: Record<string, unknown>) => {
        response.setHeader('content-type', 'application/json');
        response.end(JSON.stringify(value));
      };
      if (request.headers.authorization !== `Bearer ${token}`) return reply({ ok: false, error: 'invalid_auth' });
      const after = (ts: string) => Number(ts) > Number(body['oldest'] ?? '0');
      if (method === 'conversations.history')
        return reply({
          ok: true,
          messages: channel
            .filter((m) => (m.thread_ts === undefined || m.thread_ts === m.ts) && after(m.ts))
            .toReversed()
            .slice(0, Number(body['limit'] ?? 100)),
        });
      if (method === 'conversations.replies') return reply({ ok: true, messages: channel.filter((m) => (m.ts === body['ts'] || m.thread_ts === body['ts']) && (m.ts === body['ts'] || after(m.ts))) });
      if (method === 'chat.postMessage') {
        clock += 1;
        const ts = `2000000000.${String(clock).padStart(6, '0')}`;
        channel.push({ ts, text: String(body['text']), user: 'BOT', ...(body['thread_ts'] === undefined ? {} : { thread_ts: String(body['thread_ts']) }) });
        return reply({ ok: true, ts, channel: body['channel'] });
      }
      if (method === 'reactions.add' || method === 'chat.update') return reply({ ok: true });
      return reply({ ok: false, error: 'unknown_method' });
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { server, url: `http://127.0.0.1:${(server.address() as { port: number }).port}/api/`, channel, calls };
}

const isWake = (event: PiEvent) => event.type === 'message_end' && JSON.stringify(event['message'] ?? {}).includes('[slack] benny triage');
const wakes = (events: PiEvent[]) => events.filter(isWake).map((event) => JSON.stringify(event['message']));

function slackSandbox(url: string, token: string): Sandbox {
  const sandbox = makeSandbox();
  Object.assign(sandbox.env, { PSTACK_SLACK_API_URL: url, SLACK_BOT_TOKEN: token, PSTACK_SLACK_POLL_MS: '300' });
  return sandbox;
}

test('a Slack channel subscription fires once per new top-level report with its coordinates, and the agent replies in that thread (G3, G5)', async ({ onTestFinished }) => {
  const slack = await fakeSlack('xoxb-test');
  onTestFinished(() => new Promise<void>((resolve) => slack.server.close(() => resolve())));
  slack.channel.push({ ts: '1000000000.000001', user: 'U0', text: 'old report before the subscription' });
  const sandbox = slackSandbox(slack.url, 'xoxb-test');
  const owner = startRpc(sandbox);
  onTestFinished(async () => {
    await owner.close();
    sandbox.dispose();
  });
  const report = '1900000000.000100';
  const triage = script([
    { tool: 'slack_read_thread', args: { channel: 'C0SLACK', thread_ts: report } },
    { tool: 'slack_send', args: { channel: 'C0SLACK', thread_ts: report, text: 'triaged [benny:bug]' } },
    { tool: 'slack_react', args: { channel: 'C0SLACK', ts: report, emoji: 'eyes' } },
  ]);
  owner.send({ type: 'prompt', message: script([{ tool: 'subscribe_slack', args: { name: 'benny triage', channel: 'C0SLACK', prompt: triage } }]) });
  await owner.waitFor((event) => event.type === 'agent_settled');
  const created = toolEnds(owner.events, 'subscribe_slack')[0];
  expect(created?.isError, created?.text).toBe(false);
  slack.channel.push({ ts: report, user: 'U1', text: 'the scroll drifts every 750ms' });
  slack.channel.push({ ts: '1900000000.000200', thread_ts: report, user: 'U2', text: 'same here' });
  await owner.waitFor(isWake, 30_000);
  await owner.waitFor((event) => event.type === 'agent_settled' && owner.events.indexOf(event) > owner.events.findIndex(isWake), 30_000);
  const [wake] = wakes(owner.events);
  expect(wake).toContain('\\"source_channel_id\\": \\"C0SLACK\\"');
  expect(wake).toContain(`\\"ts\\": \\"${report}\\"`);
  expect(wake).toContain('\\"thread_ts\\": \\"\\"');
  expect(wake).toContain('the scroll drifts every 750ms');
  expect(toolEnds(owner.events, 'slack_read_thread')[0]?.text).toContain(`${report} <U1>: the scroll drifts every 750ms`);
  expect(slack.calls.filter((call) => call.method === 'chat.postMessage').map((call) => call.body)).toEqual([{ channel: 'C0SLACK', text: 'triaged [benny:bug]', thread_ts: report }]);
  expect(slack.calls.some((call) => call.method === 'reactions.add' && call.body['name'] === 'eyes' && call.body['timestamp'] === report)).toBe(true);
  // Three more polls after the wake read the same channel, the thread reply included, and fire nothing.
  const polls = () => slack.calls.filter((call) => call.method === 'conversations.history').length;
  const seen = polls();
  await expect.poll(polls, { timeout: 10_000 }).toBeGreaterThanOrEqual(seen + 3);
  expect(wakes(owner.events)).toHaveLength(1);
});

test('subscribe_slack refuses to start without a Slack token, naming how to connect (G5)', async ({ onTestFinished }) => {
  const sandbox = makeSandbox();
  delete sandbox.env['SLACK_BOT_TOKEN'];
  delete sandbox.env['SLACK_TOKEN'];
  const owner = startRpc(sandbox);
  onTestFinished(async () => {
    await owner.close();
    sandbox.dispose();
  });
  owner.send({ type: 'prompt', message: script([{ tool: 'subscribe_slack', args: { name: 'x', channel: 'C0SLACK', prompt: 'go' } }]) });
  await owner.waitFor((event) => event.type === 'agent_settled');
  const result = toolEnds(owner.events, 'subscribe_slack')[0];
  expect(result?.isError).toBe(true);
  expect(result?.text).toContain('Slack is not connected. Ask the user for a Slack bot token with request_secret');
});
