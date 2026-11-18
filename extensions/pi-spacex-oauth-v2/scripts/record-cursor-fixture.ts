// Records a live Cursor Run (prompt -> pi tool call -> tool result -> answer) as replayable server frames.
// KV blobs are dropped and checkpoints keep only their token counts: the rest is Cursor's prompt state, not behavior under test.
// Usage: CURSOR_TOKEN=... node --experimental-strip-types scripts/record-cursor-fixture.ts > test/fixtures/cursor-tool-run.json

import { randomUUID } from 'node:crypto';
import http2 from 'node:http2';

import { cursorHeaders } from '../src/cursor/models.ts';
import { decode, EnvelopeReader, encode, frame, raw } from '../src/cursor/proto.ts';
import { AGENT_URL, CursorRun } from '../src/cursor/run.ts';

const token = process.env['CURSOR_TOKEN'];
if (!token) throw new Error('set CURSOR_TOKEN');

const frames: { phase: 'before_tool' | 'after_tool'; payload?: string; end?: string }[] = [];
let phase: 'before_tool' | 'after_tool' = 'before_tool';
const tap = new EnvelopeReader();

const session = http2.connect(AGENT_URL);
const stream = session.request({
  ':method': 'POST',
  ':path': '/agent.v1.AgentService/Run',
  'content-type': 'application/connect+proto',
  'connect-protocol-version': '1',
  'x-request-id': randomUUID(),
  'x-cursor-agent-allowed-tools': 'mcp_tool_call,get_mcp_tools_tool_call',
  ...cursorHeaders(token),
});
const run = new CursorRun(
  {
    token,
    conversationId: randomUUID(),
    modelId: 'composer-2.5',
    userText: "What's the weather in Paris? Call get_weather, then answer in one short sentence.",
    systemPrompt: 'You are a terse assistant.',
    tools: [{ name: 'get_weather', description: 'Get the current weather for a city.', parameters: { type: 'object', properties: { city: { type: 'string' } }, required: ['city'] } }],
    checkpoint: undefined,
    blobs: new Map(),
  },
  {
    write: (b) => stream.write(b),
    close: () => {
      stream.close();
      session.close();
    },
  },
);
stream.on('data', (chunk: Buffer) => {
  for (const env of tap.push(chunk)) {
    if (env.end) frames.push({ phase, end: env.json });
    else {
      const m = decode(env.payload);
      const checkpoint = raw(m, 3);
      const tokenDetails = checkpoint && raw(decode(checkpoint), 5);
      const payload = checkpoint ? (tokenDetails ? encode([[3, encode([[5, tokenDetails]])]]) : undefined) : m.bytes.has(4) ? undefined : env.payload;
      if (payload) frames.push({ phase, payload: Buffer.from(frame(payload)).toString('base64') });
    }
  }
  run.receive(chunk);
});
run.onEvent = (e) => {
  if (e.type === 'tool_calls') {
    phase = 'after_tool';
    run.submitToolResults(e.calls.map((c) => ({ id: c.id, text: 'Sunny, 21C', isError: false })));
  }
  if (e.type === 'end') {
    process.stdout.write(`${JSON.stringify({ recordedAt: new Date().toISOString(), frames }, null, 1)}\n`);
    process.exit(e.error ? 1 : 0);
  }
};
