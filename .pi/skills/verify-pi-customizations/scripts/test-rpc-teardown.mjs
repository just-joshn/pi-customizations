import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { createRpcSession } from '../lib/rpc.mjs';

const script = fileURLToPath(import.meta.url);
const root = mkdtempSync(join(tmpdir(), 'f016-teardown-'));
const quote = (value) => `'${value.replaceAll("'", "'\\''")}'`;
const fixture = join(root, 'fixture');
writeFileSync(fixture, `#!/bin/sh\nexec ${quote(process.execPath)} ${quote(script)} --fixture "$@"\n`, { mode: 0o700 });

if (process.argv.includes('--fixture')) {
  let buffer = '';
  let active = false;
  let compacting = false;
  const mode = process.env.F016_MODE;
  const reply = (command, data = null, success = true) => process.stdout.write(`${JSON.stringify({ type: 'response', id: command.id, command: command.type, success, data, error: success ? undefined : 'abort rejected' })}\n`);
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => {
    buffer += chunk;
    while (buffer.includes('\n')) {
      const boundary = buffer.indexOf('\n');
      const command = JSON.parse(buffer.slice(0, boundary));
      buffer = buffer.slice(boundary + 1);
      if (command.type === 'prompt') {
        active = true;
        reply(command, { disposition: 'started' });
      }
      if (command.type === 'hold') continue;
      if (command.type === 'get_state' && mode !== 'state-frozen') {
        const profiles = {
          malformed: { isStreaming: false, pendingMessageCount: 0 },
          queued: { isStreaming: false, isCompacting: false, pendingMessageCount: 1 },
          compacting: { isStreaming: false, isCompacting: true, pendingMessageCount: 0 },
        };
        reply(command, profiles[mode] ?? { isStreaming: active, isCompacting: compacting, pendingMessageCount: 0 });
      }
      if (command.type === 'abort') {
        process.stdout.write(`${JSON.stringify({ type: 'abort_received' })}\n`);
        if (mode === 'frozen') continue;
        if (mode === 'reject') {
          reply(command, null, false);
          continue;
        }
        if (mode === 'early') {
          reply(command);
          compacting = true;
          setTimeout(() => {
            active = false;
            compacting = false;
          }, 100);
        } else {
          active = false;
          reply(command);
        }
      }
    }
  });
  process.stdin.on('end', () => {
    process.stdout.write(`${JSON.stringify({ type: 'eof', active, compacting })}\n`);
    if (active || compacting) process.stdout.write(`${JSON.stringify({ type: 'extension_error', error: 'stale ctx after EOF' })}\n`);
    process.exit(0);
  });
} else {
  const session = (mode) => createRpcSession({ packagePath: script, agentDir: root, piBin: fixture, env: { F016_MODE: mode }, shutdownTimeoutMs: 300, requestTimeoutMs: 1000 });
  const forcedModes = ['reject', 'frozen', 'state-frozen', 'malformed', 'queued', 'compacting'];
  for (const mode of ['normal', 'early', ...forcedModes]) {
    test(`active close drains or kills without active EOF (${mode})`, async () => {
      const rpc = session(mode);
      try {
        await rpc.send({ type: 'prompt', message: 'held' });
        const pending = rpc.send({ type: 'hold' }).catch((error) => error);
        const observer = rpc.waitFor((record) => record.type === 'never-emitted').catch((error) => error);
        const first = rpc.close();
        const second = rpc.close();
        assert.equal(first, second);
        await assert.rejects(rpc.send({ type: 'get_state' }, { teardown: true }), /closed/);
        await second;
        assert.equal(rpc.pid, null, 'repeated close waits for actual teardown');
        await first;
        assert.equal(rpc.ofType('abort_received').length, 1);
        assert.deepEqual(rpc.ofType('extension_error'), []);
        assert.equal(
          rpc.ofType('eof').some((record) => record.active || record.compacting),
          false,
        );
        if (forcedModes.includes(mode)) {
          assert.equal(rpc.ofType('eof').length, 0);
          assert.equal(rpc.ofType('rpc_shutdown_error').length, 1);
        }
        assert.match((await pending).message, /exited|closed/);
        assert.match((await observer).message, /exited|closed/);
        await assert.rejects(rpc.state(), /closed/);
      } finally {
        await rpc.close();
      }
    });
  }
  test('idle close sends EOF only after drain', async () => {
    const rpc = session('normal');
    await rpc.state();
    await rpc.close();
    assert.deepEqual(rpc.ofType('extension_error'), []);
    assert.equal(rpc.ofType('eof').length, 1);
  });
  test('restart rejects new work while draining its child', async () => {
    const rpc = session('early');
    let restarting;
    try {
      await rpc.state();
      restarting = rpc.restart().catch((error) => error);
      await assert.rejects(rpc.send({ type: 'prompt', message: 'must not start during drain' }), /stopping/);
    } finally {
      await restarting;
      await rpc.close();
    }
    assert.deepEqual(rpc.ofType('extension_error'), []);
  });
  test('original prompt deadline error survives teardown', async () => {
    const rpc = createRpcSession({ packagePath: script, agentDir: root, piBin: fixture, idleTimeoutMs: 80, shutdownTimeoutMs: 300 });
    let captured;
    try {
      await rpc.prompt('held');
      assert.fail('held prompt must reach its unchanged deadline');
    } catch (error) {
      captured = error;
      assert.match(error.message, /RPC prompt did not settle within 80ms/);
    } finally {
      await rpc.close();
    }
    assert.match(captured.message, /RPC prompt did not settle within 80ms/);
    assert.deepEqual(rpc.ofType('extension_error'), []);
  });
  test('real installed Pi closes a held provider without stale context errors', async () => {
    const pi = execFileSync('/bin/sh', ['-c', 'command -v pi'], { encoding: 'utf8' }).trim();
    const version = readFileSync(join(homedir(), '.pi/agent/install/current-version'), 'utf8').trim();
    const ai = join(homedir(), '.pi/agent/install/releases', version, 'node_modules/@earendil-works/pi-ai/dist/index.js');
    const provider = join(root, 'provider.mjs');
    writeFileSync(
      provider,
      `import { createAssistantMessageEventStream } from ${JSON.stringify(pathToFileURL(ai).href)};
export default function(pi) {
 pi.registerProvider('f016', { api: 'openai-completions', baseUrl: 'http://127.0.0.1:1', apiKey: 'fixture', models: [{ id: 'fixture', name: 'Fixture', reasoning: false, input: ['text'], contextWindow: 32000, maxTokens: 100, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }], streamSimple: (model, context, opts) => {
 const stream = createAssistantMessageEventStream();
 opts.signal.addEventListener('abort', () => { const message = { role: 'assistant', api: model.api, provider: model.provider, model: model.id, content: [], stopReason: 'aborted', timestamp: Date.now(), usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } }; stream.push({ type: 'error', reason: 'aborted', error: message }); stream.end(message); }, { once: true });
 return stream;
 } });
}`,
    );
    const agent = join(root, 'agent');
    mkdirSync(agent);
    const wrapper = join(root, 'pi');
    writeFileSync(wrapper, `#!/bin/sh\nexec ${quote(pi)} --provider f016 --model fixture --thinking off "$@"\n`, { mode: 0o700 });
    const packagePath = resolve(dirname(script), '../../../../extensions/pi-pstack/src/index.ts');
    const rpc = createRpcSession({
      packagePath,
      agentDir: agent,
      cwd: root,
      piBin: wrapper,
      extraExtensions: [provider],
      capturePath: join(root, 'real-rpc.jsonl'),
      env: { PI_OFFLINE: '1', PI_SKIP_VERSION_CHECK: '1', HOME: root, TMPDIR: root },
    });
    try {
      await rpc.send({ type: 'prompt', message: 'Held lifecycle fixture. No workflow completion claim.' });
      assert.equal((await rpc.state()).isStreaming, true);
      await rpc.close();
      assert.deepEqual(rpc.ofType('extension_error'), []);
      assert.doesNotMatch(rpc.stderr, /stale/);
    } finally {
      await rpc.close();
    }
  });
  process.stdout.write(`F016 lifecycle artifacts ${root}\n`);
}
