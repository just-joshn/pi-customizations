import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { startResponsesServer } from '../test/support/responses-server.ts';

const exec = promisify(execFile);
const packageDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const rows = [
  { model: 'grok-4.7-build-fast', thinking: 'xhigh', physical: 'grok-4.7-build-fast', expected: { top_k: 20, top_p: 0.9, min_p: 0.05, reasoning: { effort: 'xhigh', summary: 'auto' } } },
  { model: 'grok-4.7-xhigh-fast', thinking: 'xhigh', physical: 'grok-4.7-build-fast', expected: { top_k: 20, top_p: 0.9, min_p: 0.05, reasoning: { effort: 'xhigh', summary: 'auto' } } },
  { model: 'grok-4.7-build-fast', thinking: 'medium', physical: 'grok-4.7-build-fast', expected: { top_k: 40, top_p: 0.9, reasoning: { effort: 'medium', summary: 'auto' } } },
  { model: 'grok-4.5', thinking: 'xhigh', physical: 'grok-4.5', expected: { top_k: 10, top_p: 0.9, reasoning: { effort: 'high', summary: 'auto' } } },
];
const agentDir = await mkdtemp(join(tmpdir(), 'grok-sampling-'));
const server = await startResponsesServer();
try {
  await writeFile(join(agentDir, 'auth.json'), JSON.stringify({ 'grok-build': { type: 'oauth', access: 'loopback-fixture', refresh: 'loopback-fixture', expires: Date.UTC(2100, 0, 1) } }), { mode: 0o600 });
  await writeFile(
    join(agentDir, 'models.json'),
    JSON.stringify({
      providers: {
        'grok-build': {
          baseUrl: server.baseUrl,
          modelOverrides: {
            'grok-4.7-build-fast': { samplingParams: { top_k: 40, top_p: 0.9 }, samplingParamsByThinkingLevel: { xhigh: { top_k: 20, min_p: 0.05 } } },
            'grok-4.5': { samplingParams: { top_k: 40, top_p: 0.9 }, samplingParamsByThinkingLevel: { high: { top_k: 10 }, xhigh: { top_k: 99 } } },
          },
        },
      },
    }),
  );
  for (const row of rows) {
    const before = server.requests.length;
    const child = exec(process.env.PI_SAMPLING_EXECUTABLE ?? 'pi', ['--offline', '--no-extensions', '-e', packageDir, '--no-session', '--print', '--model', `grok-build/${row.model}`, '--thinking', row.thinking, 'Reply OK.'], {
      cwd: agentDir,
      env: { ...process.env, PI_CODING_AGENT_DIR: agentDir },
      timeout: 60_000,
    });
    child.child.stdin?.end();
    const { stdout } = await child;
    assert.match(stdout, /OK/);
    assert.equal(server.requests.length, before + 1);
    const recorded = server.requests[before];
    assert.ok(recorded);
    assert.equal(recorded.headers['x-grok-model-override'], row.physical);
    assert.ok(typeof recorded.body === 'object' && recorded.body !== null);
    assert.equal(Reflect.get(recorded.body, 'model'), row.physical);
    for (const [key, value] of Object.entries(row.expected)) assert.deepEqual(Reflect.get(recorded.body, key), value, `${row.model}/${row.thinking} ${key}`);
    if (!('min_p' in row.expected)) assert.equal(Reflect.get(recorded.body, 'min_p'), undefined);
    process.stdout.write(`PASS ${row.model}/${row.thinking} ${JSON.stringify(row.expected)}\n`);
  }
} finally {
  await server.close();
  await rm(agentDir, { recursive: true, force: true });
}
