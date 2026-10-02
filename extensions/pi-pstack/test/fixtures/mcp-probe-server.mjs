import { createInterface } from 'node:readline';

const send = (message) => process.stdout.write(`${JSON.stringify(message)}\n`);
const handlers = {
  initialize: (params) => ({ protocolVersion: params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'probe', version: '1.0.0' } }),
  'tools/list': () => ({ tools: [{ name: 'echo', description: 'Echo a message', inputSchema: { type: 'object', properties: { message: { type: 'string' } } } }] }),
  'tools/call': (params) => ({ content: [{ type: 'text', text: String(params.arguments?.message ?? '') }] }),
  ping: () => ({}),
};

createInterface({ input: process.stdin }).on('line', (line) => {
  const request = JSON.parse(line);
  if (request.id === undefined) return;
  const handler = handlers[request.method];
  if (!handler) send({ jsonrpc: '2.0', id: request.id, error: { code: -32601, message: 'Method not found' } });
  else send({ jsonrpc: '2.0', id: request.id, result: handler(request.params ?? {}) });
});
