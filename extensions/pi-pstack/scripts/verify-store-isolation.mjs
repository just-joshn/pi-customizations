import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, realpath, symlink, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { rpcProcess } from './rpc-process.mjs';

if (process.platform !== 'darwin') throw new Error('This experiment requires macOS sandbox-exec. It does not establish cross-platform isolation.');
const root = resolve(process.argv[2] ?? `/tmp/pstack-store-isolation-${process.pid}`);
const cli = join(dirname(fileURLToPath(import.meta.resolve('@earendil-works/pi-coding-agent'))), 'bundle', 'cli.js');
const store = join(root, 'sessions');
const own = join(store, 'task-owned');
const workspace = join(root, 'workspace');
await Promise.all([mkdir(own, { recursive: true }), mkdir(workspace, { recursive: true })]);
await writeFile(join(store, 'parent.jsonl'), 'PRIVATE_FIXTURE_ONLY\n');
await writeFile(join(own, 'own.jsonl'), 'OWN_FIXTURE_ONLY\n');
const link = join(workspace, 'parent-link');
try {
  await symlink(join(store, 'parent.jsonl'), link);
} catch (error) {
  if (error.code !== 'EEXIST') throw error;
}
const profile = `(version 1) (allow default) (deny file-read* (require-all (subpath ${JSON.stringify(await realpath(store))}) (require-not (subpath ${JSON.stringify(await realpath(own))}))))`;
await writeFile(join(root, 'profile.sb'), profile);
const quote = (value) => `'${value.replaceAll("'", "'\\''")}'`;
const read = (path) => `head -c 1 ${quote(path)} >/dev/null 2>&1 && printf readable || printf blocked`;
const probes = [
  { name: 'parent', command: read(join(store, 'parent.jsonl')), isolated: 'blocked' },
  { name: 'owned', command: read(join(own, 'own.jsonl')), isolated: 'readable' },
  { name: 'symlink', command: read(link), isolated: 'blocked' },
  { name: 'descendant', command: `/bin/sh -c ${quote(read(join(store, 'parent.jsonl')))}`, isolated: 'blocked' },
];
const results = [];
for (const sandbox of [false, true]) {
  const args = [cli, '--mode', 'rpc', '--approve', '--session-dir', own, '--no-extensions', '-e', fileURLToPath(new URL('../test/journey-provider.ts', import.meta.url)), '--provider', 'journey-test', '--model', 'recorder'];
  const child = spawn(sandbox ? '/usr/bin/sandbox-exec' : process.execPath, sandbox ? ['-f', join(root, 'profile.sb'), process.execPath, ...args] : args, {
    cwd: workspace,
    env: { ...process.env, PI_CODING_AGENT_DIR: join(root, sandbox ? 'sandbox-agent' : 'baseline-agent') },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const rpc = rpcProcess(child);
  try {
    const state = await rpc.send({ type: 'get_state' });
    assert(state.sessionId, 'real Pi RPC session started');
    await rpc.send({ type: 'set_session_name', name: sandbox ? 'sandbox-fixture' : 'baseline-fixture' });
    await rpc.send({ type: 'prompt', message: 'STORE_ISOLATION_MAIN_FIXTURE' });
    const persisted = await rpc.send({ type: 'get_state' });
    assert(persisted.sessionFile, 'task-owned durable session has a file path');
    assert((await realpath(persisted.sessionFile)).startsWith(`${await realpath(own)}/`), 'task-owned durable session file is available');
    const observations = [];
    for (const probe of probes) {
      const response = await rpc.send({ type: 'bash', command: probe.command });
      observations.push({ name: probe.name, response });
      assert.equal(response.output, sandbox ? probe.isolated : 'readable', `${sandbox ? 'sandbox' : 'baseline'} ${probe.name}`);
    }
    const history = await rpc.send({ type: 'get_entries' });
    const assistants = history.entries.filter((entry) => entry.type === 'message' && entry.message.role === 'assistant');
    assert(assistants.length > 0, 'scripted main-session response persisted');
    assert(
      assistants.every((entry) => entry.message.content.every((block) => block.type !== 'toolCall')),
      'no Task or other model tool calls',
    );
    assert(
      assistants.every((entry) => entry.message.usage.totalTokens === 0),
      'scripted provider has zero inference tokens',
    );
    results.push({ sandbox, pid: child.pid, sessionFile: persisted.sessionFile, observations });
  } finally {
    await rpc.close();
  }
}
await writeFile(join(root, 'results.json'), `${JSON.stringify({ scope: 'macOS fixture-store experiment, not integrated cloud Task isolation', results }, null, 2)}\n`);
process.stdout.write(`Verified ${probes.length * 2} observations. Evidence ${root}\n`);
