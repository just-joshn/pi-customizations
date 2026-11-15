// Records a live Cursor Run (prompt -> pi tool call -> tool result -> answer) as replayable server frames.
// Conversation checkpoints and KV blobs are dropped: they carry Cursor's prompt state, not behavior under test.
// Usage: CURSOR_TOKEN=... node --experimental-strip-types scripts/record-cursor-fixture.ts > test/fixtures/cursor-tool-run.json

import { randomUUID } from 'node:crypto';
import http2 from 'node:http2';

import { cursorHeaders } from '../src/cursor/models.ts';
import { decode, EnvelopeReader, frame } from '../src/cursor/proto.ts';
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
    else if (!decode(env.payload).bytes.has(3) && !decode(env.payload).bytes.has(4)) frames.push({ phase, payload: Buffer.from(frame(env.payload)).toString('base64') });
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
