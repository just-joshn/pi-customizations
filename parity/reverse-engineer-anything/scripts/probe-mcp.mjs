#!/usr/bin/env node
// Reference-oracle probe: speaks JSON-RPC over stdio to the REA MCP server and
// records initialize + tools/list + prompts/list so the port has an authoritative
// catalog fixture. Lives under parity/ and is not shipped with the skill.
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const outDir = process.argv[2];
if (!outDir) {
  process.stderr.write('usage: probe-mcp.mjs <output-dir> [command...]\n');
  process.exit(2);
}
const [command = 'npx', ...args] = process.argv.slice(3);
const child = spawn(command, args.length > 0 ? args : ['-y', 'rea-agents@latest', 'mcp'], { stdio: ['pipe', 'pipe', 'pipe'] });

let buffer = '';
const pending = new Map();
const received = [];
child.stdout.on('data', (chunk) => {
  buffer += chunk.toString();
  let index = buffer.indexOf('\n');
  while (index >= 0) {
    const line = buffer.slice(0, index).trim();
    buffer = buffer.slice(index + 1);
    if (line !== '') {
      const message = JSON.parse(line);
      received.push(message);
      if (message.id !== undefined && pending.has(message.id)) {
        pending.get(message.id)(message);
        pending.delete(message.id);
      }
    }
    index = buffer.indexOf('\n');
  }
});
let stderr = '';
child.stderr.on('data', (chunk) => {
  stderr += chunk.toString();
});

const call = (id, method, params) =>
  new Promise((resolve) => {
    pending.set(id, resolve);
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
  });

const started = Date.now();
const init = await call(1, 'initialize', {
  protocolVersion: '2025-06-18',
  capabilities: {},
  clientInfo: { name: 'pi-customizations-parity-probe', version: '1.0.0' },
});
child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
const tools = await call(2, 'tools/list', {});
const prompts = await call(3, 'prompts/list', {});
const elapsedMs = Date.now() - started;

mkdirSync(outDir, { recursive: true });
const write = (name, value) => writeFileSync(join(outDir, name), `${JSON.stringify(value, null, 2)}\n`);
write('initialize.json', init);
write('tools-list.json', tools);
write('prompts-list.json', prompts);
write('probe-meta.json', {
  elapsedMs,
  toolCount: tools.result?.tools?.length ?? 0,
  promptCount: tools.result?.prompts?.length ?? prompts.result?.prompts?.length ?? 0,
  stderr: stderr
    .split('\n')
    .filter((line) => !line.startsWith('npm warn'))
    .join('\n')
    .trim(),
});

const names = (tools.result?.tools ?? []).map((tool) => tool.name).sort();
process.stdout.write(`${JSON.stringify({ toolCount: names.length, promptCount: prompts.result?.prompts?.length ?? 0, elapsedMs, names })}\n`);
child.kill('SIGTERM');
