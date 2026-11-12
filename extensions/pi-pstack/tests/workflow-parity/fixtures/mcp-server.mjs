// A tiny stdio MCP server (newline-delimited JSON-RPC 2.0). Tools:
//   lookup_decision {topic}      a decision record with a stable id and URL, so a citation can be checked against it
//   slow_echo {label, ms}        sleeps ms, then returns its own label with start and end times, to show calls stay isolated
//   fail_now {reason}            returns an MCP error result (isError), to show one failing call does not touch its neighbours
//   big_text {chars}             returns that many characters, to show codemode keeps large results out of the model's context
// Every call is appended to $MCP_FIXTURE_LOG, one JSON line each, so a test can see which process called what.
import { appendFileSync } from 'node:fs';
import { createInterface } from 'node:readline';

const DECISIONS = {
  coupon: { id: 'DEC-142', url: 'https://wiki.example/decisions/142', text: 'Percent coupons were chosen over fixed amounts so one promotion works for every cart size.' },
};

const TOOLS = [
  { name: 'lookup_decision', description: 'Look up the recorded product decision for a topic.', inputSchema: { type: 'object', properties: { topic: { type: 'string' } }, required: ['topic'] }, annotations: { readOnlyHint: true } },
  { name: 'slow_echo', description: 'Wait ms milliseconds, then return the label given.', inputSchema: { type: 'object', properties: { label: { type: 'string' }, ms: { type: 'number' } }, required: ['label', 'ms'] }, annotations: { readOnlyHint: true } },
  { name: 'fail_now', description: 'Always return an error result.', inputSchema: { type: 'object', properties: { reason: { type: 'string' } }, required: ['reason'] } },
  { name: 'big_text', description: 'Return a long text of the given length.', inputSchema: { type: 'object', properties: { chars: { type: 'number' } }, required: ['chars'] }, annotations: { readOnlyHint: true } },
];

const send = (message) => process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', ...message })}\n`);
const log = (entry) => process.env.MCP_FIXTURE_LOG && appendFileSync(process.env.MCP_FIXTURE_LOG, `${JSON.stringify({ pid: process.pid, at: Date.now(), ...entry })}\n`);
const reply = (id, text) => send({ id, result: { content: [{ type: 'text', text }] } });

createInterface({ input: process.stdin }).on('line', async (line) => {
  if (line.trim() === '') return;
  const request = JSON.parse(line);
  const { id, method, params } = request;
  if (method === 'initialize') {
    log({ method });
    return send({ id, result: { protocolVersion: params?.protocolVersion ?? '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'decisions-fixture', version: '1.0.0' }, instructions: 'Product decision records.' } });
  }
  if (id === undefined) return;
  if (method === 'ping') return send({ id, result: {} });
  if (method === 'tools/list') return send({ id, result: { tools: TOOLS } });
  if (method === 'tools/call') {
    const { name, arguments: args = {} } = params;
    log({ method, tool: name, args });
    if (name === 'lookup_decision') {
      const found = DECISIONS[String(args.topic).toLowerCase()];
      return reply(id, found ? `${found.id}: ${found.text} Source: ${found.url}` : `No decision is recorded for ${args.topic}.`);
    }
    if (name === 'slow_echo') {
      const started = Date.now();
      await new Promise((done) => setTimeout(done, Number(args.ms)));
      return reply(id, JSON.stringify({ label: args.label, started, ended: Date.now() }));
    }
    if (name === 'fail_now') return send({ id, result: { isError: true, content: [{ type: 'text', text: `failed: ${args.reason}` }] } });
    if (name === 'big_text') return reply(id, 'x'.repeat(Number(args.chars)));
    return send({ id, error: { code: -32602, message: `unknown tool ${name}` } });
  }
  send({ id, error: { code: -32601, message: `method ${method} not found` } });
});
