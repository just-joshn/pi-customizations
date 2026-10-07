const fs = process.getBuiltinModule('node:fs');

const BARRIER = process.env.PSTACK_HOOKS_BARRIER;
const TOOL = process.env.PSTACK_HOOKS_MCP_TOOL ?? 'hk_echo';

function mark(suffix, content = '') {
  if (BARRIER) fs.writeFileSync(`${BARRIER}.${suffix}`, `${Date.now()} ${content}\n`);
}

function waitFor(suffix, timeoutMs = 120000) {
  const path = `${BARRIER}.${suffix}`;
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const tick = () => {
      if (fs.existsSync(path)) return resolve();
      if (Date.now() > deadline) return reject(new Error(`hk mcp fixture timed out waiting for ${path}`));
      setTimeout(tick, 25);
    };
    tick();
  });
}

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function handle(message) {
  if (message.method === 'initialize') {
    waitFor('release')
      .then(() =>
        send({
          jsonrpc: '2.0',
          id: message.id,
          result: {
            protocolVersion: message.params?.protocolVersion ?? '2025-06-18',
            capabilities: { tools: {} },
            serverInfo: { name: 'hkmcp', version: '1.0.0' },
          },
        }),
      )
      .catch(() => {});
    return;
  }
  if (message.method === 'notifications/initialized') return;
  if (message.method === 'ping') {
    send({ jsonrpc: '2.0', id: message.id, result: {} });
    return;
  }
  if (message.method === 'tools/list') {
    send({
      jsonrpc: '2.0',
      id: message.id,
      result: { tools: [{ name: TOOL, description: 'Echo probe tool.', inputSchema: { type: 'object', properties: {}, additionalProperties: false } }] },
    });
    mark('mcp-connected');
    return;
  }
  if (message.method === 'tools/call') {
    mark('mcp-called', message.params?.name ?? '');
    send({ jsonrpc: '2.0', id: message.id, result: { content: [{ type: 'text', text: 'HK_MCP_CALLED' }] } });
    return;
  }
  if (message.id !== undefined) send({ jsonrpc: '2.0', id: message.id, error: { code: -32601, message: `unsupported method ${message.method}` } });
}

mark('mcp-started');

let buffer = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  buffer += chunk;
  let boundary = buffer.indexOf('\n');
  while (boundary >= 0) {
    const line = buffer.slice(0, boundary).trim();
    buffer = buffer.slice(boundary + 1);
    if (line) handle(JSON.parse(line));
    boundary = buffer.indexOf('\n');
  }
});
process.stdin.on('end', () => process.exit(0));
