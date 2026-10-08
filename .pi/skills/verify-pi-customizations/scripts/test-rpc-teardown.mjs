import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { test } from 'node:test';
import { createRpcSession } from '../lib/rpc.mjs';

const script = fileURLToPath(import.meta.url);
const root = mkdtempSync(join(tmpdir(), 'f016-teardown-'));
const quote = value => `'${value.replaceAll("'", "'\\''")}'`;
const fixture = join(root, 'fixture');
writeFileSync(fixture, `#!/bin/sh\nexec ${quote(process.execPath)} ${quote(script)} --fixture "$@"\n`, { mode: 0o700 });

if (process.argv.includes('--fixture')) {
  let buffer = '';
  let active = false;
  let compacting = false;
  const mode = process.env.F016_MODE;
  const reply = (command, data = null, success = true) => process.stdout.write(`${JSON.stringify({ type: 'response', id: command.id, command: command.type, success, data, error: success ? undefined : 'abort rejected' })}\n`);
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', chunk => {
    buffer += chunk;
    let boundary;
    while ((boundary = buffer.indexOf('\n')) >= 0) {
      const command = JSON.parse(buffer.slice(0, boundary));
      buffer = buffer.slice(boundary + 1);
      if (command.type === 'prompt') { active = true; reply(command, { disposition: 'started' }); }
      if (command.type === 'hold') continue;
      if (command.type === 'get_state') reply(command, { isStreaming: active, isCompacting: compacting, pendingMessageCount: 0 });
      if (command.type === 'abort') {
        process.stdout.write(`${JSON.stringify({ type: 'abort_received' })}\n`);
        if (mode === 'frozen') continue;
        if (mode === 'reject') { reply(command, null, false); continue; }
        if (mode === 'early') {
          reply(command);
          compacting = true;
          setTimeout(() => { active = false; compacting = false; }, 100);
        } else { active = false; reply(command); }
      }
    }
  });
  process.stdin.on('end', () => {
    process.stdout.write(`${JSON.stringify({ type: 'eof', active, compacting })}\n`);
    if (active || compacting) process.stdout.write(`${JSON.stringify({ type: 'extension_error', error: 'stale ctx after EOF' })}\n`);
    process.exit(0);
  });
} else {
  const session = mode => createRpcSession({ packagePath: script, agentDir: root, piBin: fixture, env: { F016_MODE: mode }, shutdownTimeoutMs: 300, requestTimeoutMs: 1000 });
  for (const mode of ['normal', 'early', 'reject', 'frozen']) {
    test(`active close drains or kills without active EOF (${mode})`, async () => {
      const rpc = session(mode);
      try {
        await rpc.send({ type: 'prompt', message: 'held' });
        const pending = rpc.send({ type: 'hold' }).catch(error => error);
        const first = rpc.close();
        const second = rpc.close();
        await second;
        assert.equal(rpc.pid, null, 'repeated close waits for actual teardown');
        await first;
        assert.equal(rpc.ofType('abort_received').length, 1);
        assert.deepEqual(rpc.ofType('extension_error'), []);
        assert.equal(rpc.ofType('eof').some(record => record.active || record.compacting), false);
        if (mode === 'reject' || mode === 'frozen') assert.equal(rpc.ofType('eof').length, 0);
        assert.match((await pending).message, /exited|closed/);
        await assert.rejects(rpc.state(), /closed/);
      } finally { await rpc.close(); }
    });
  }
  test('idle close sends EOF only after drain', async () => {
    const rpc = session('normal');
    await rpc.state();
    await rpc.close();
    assert.deepEqual(rpc.ofType('extension_error'), []);
    assert.equal(rpc.ofType('eof').length, 1);
  });
  test('real installed Pi closes a held provider without stale context errors', async () => {
    const pi = execFileSync('/bin/sh', ['-c', 'command -v pi'], { encoding: 'utf8' }).trim();
    const version = readFileSync(join(homedir(), '.pi/agent/install/current-version'), 'utf8').trim();
    const ai = join(homedir(), '.pi/agent/install/releases', version, 'node_modules/@earendil-works/pi-ai/dist/index.js');
    const provider = join(root, 'provider.mjs');
    writeFileSync(provider, `import { createAssistantMessageEventStream } from ${JSON.stringify(pathToFileURL(ai).href)};
export default function(pi) {
 pi.registerProvider('f016', { api: 'openai-completions', baseUrl: 'http://127.0.0.1:1', apiKey: 'fixture', models: [{ id: 'fixture', name: 'Fixture', reasoning: false, input: ['text'], contextWindow: 32000, maxTokens: 100, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }], streamSimple: (model, context, opts) => {
 const stream = createAssistantMessageEventStream();
 opts.signal.addEventListener('abort', () => { const message = { role: 'assistant', api: model.api, provider: model.provider, model: model.id, content: [], stopReason: 'aborted', timestamp: Date.now(), usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } }; stream.push({ type: 'error', reason: 'aborted', error: message }); stream.end(message); }, { once: true });
 return stream;
 } });
}`);
    const agent = join(root, 'agent');
    mkdirSync(agent);
    const wrapper = join(root, 'pi');
    writeFileSync(wrapper, `#!/bin/sh\nexec ${quote(pi)} --provider f016 --model fixture --thinking off "$@"\n`, { mode: 0o700 });
    const packagePath = resolve(dirname(script), '../../../../extensions/pi-pstack/src/index.ts');
    const rpc = createRpcSession({ packagePath, agentDir: agent, cwd: root, piBin: wrapper, extraExtensions: [provider], capturePath: join(root, 'real-rpc.jsonl'), env: { PI_OFFLINE: '1', PI_SKIP_VERSION_CHECK: '1', HOME: root, TMPDIR: root } });
    try {
      await rpc.send({ type: 'prompt', message: 'Held lifecycle fixture. No workflow completion claim.' });
      assert.equal((await rpc.state()).isStreaming, true);
      await rpc.close();
      assert.deepEqual(rpc.ofType('extension_error'), []);
      assert.doesNotMatch(rpc.stderr, /stale/);
    } finally { await rpc.close(); }
  });
  process.stdout.write(`F016 lifecycle artifacts ${root}\n`);
}
