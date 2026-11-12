// A stdio MCP server (newline-delimited JSON-RPC 2.0) with one read tool and one write tool. Every tools/call is appended
// to $MCP_FIXTURE_LOG, so a test sees which tool reached the server whatever route the worker used.
import { appendFileSync } from 'node:fs';
import { createInterface } from 'node:readline';

const TOOLS = [
  { name: 'read_note', description: 'Read the note stored under a key.', inputSchema: { type: 'object', properties: { key: { type: 'string' } }, required: ['key'] }, annotations: { readOnlyHint: true } },
  { name: 'write_note', description: 'Store a note under a key, replacing what was there.', inputSchema: { type: 'object', properties: { key: { type: 'string' }, text: { type: 'string' } }, required: ['key', 'text'] } },
];

const send = (message) => process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', ...message })}\n`);
const notes = { alpha: 'the stored note' };

createInterface({ input: process.stdin }).on('line', (line) => {
  if (line.trim() === '') return;
  const { id, method, params } = JSON.parse(line);
  if (method === 'initialize') return send({ id, result: { protocolVersion: params?.protocolVersion ?? '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'notes-fixture', version: '1.0.0' }, instructions: 'Notes: read_note reads, write_note writes.' } });
  if (id === undefined) return;
  if (method === 'ping') return send({ id, result: {} });
  if (method === 'tools/list') return send({ id, result: { tools: TOOLS } });
  if (method === 'tools/call') {
    const { name, arguments: args = {} } = params;
    if (process.env.MCP_FIXTURE_LOG) appendFileSync(process.env.MCP_FIXTURE_LOG, `${JSON.stringify({ tool: name, args })}\n`);
    if (name === 'read_note') return send({ id, result: { content: [{ type: 'text', text: notes[args.key] ?? `no note ${args.key}` }] } });
    if (name === 'write_note') {
      notes[args.key] = args.text;
      return send({ id, result: { content: [{ type: 'text', text: `stored ${args.key}` }] } });
    }
    return send({ id, error: { code: -32602, message: `unknown tool ${name}` } });
  }
  send({ id, error: { code: -32601, message: `method ${method} not found` } });
});
