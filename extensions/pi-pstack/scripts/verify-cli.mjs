import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { rpcProcess } from './rpc-process.mjs';

const root = process.argv[2] ? resolve(process.argv[2]) : fileURLToPath(new URL('../', import.meta.url));
const cli = join(dirname(fileURLToPath(import.meta.resolve('@earendil-works/pi-coding-agent'))), 'bundle/cli.js');

async function verify(client) {
  const commands = await client.send({ type: 'get_commands' });
  for (const name of [
    'poteto-mode',
    'setup-pstack',
    'pstack',
    'how',
    'bro',
    'deslop',
    'control-cli',
    'control-ui',
    'verify-this',
    'pr-review-canvas',
    'thermo-nuclear-code-quality-review',
    'loop',
    'correct',
    'benchmark-checklist',
    'principle-explain-the-number',
  ]) {
    assert.ok(
      commands.commands.some((command) => command.name === name),
      `CLI command ${name}`,
    );
  }
  for (const name of ['how', 'bro', 'deslop', 'control-cli', 'control-ui', 'loop', 'correct', 'benchmark-checklist', 'principle-explain-the-number']) {
    assert.equal(commands.commands.find((command) => command.name === name)?.source, 'prompt', `${name} must be a native prompt template`);
  }
  for (const name of ['poteto-mode', 'setup-pstack', 'pstack']) {
    assert.equal(commands.commands.find((command) => command.name === name)?.source, 'extension', `${name} requires runtime behavior`);
  }
  await client.send({ type: 'prompt', message: '/pstack' });
  await client.send({ type: 'prompt', message: '/pstack status' });
  await client.send({ type: 'prompt', message: '/pstack todos' });
  const messages = await client.send({ type: 'get_messages' });
  const statusList = messages.messages.filter((message) => message.role === 'custom' && message.customType === 'pstack-status');
  assert.equal(statusList.length, 3);
  assert.match(String(statusList[0]?.content), /73 skills, 71 prompt templates/);
  assert.match(String(statusList[0]?.content), /team-kit 1.2.0/);
  assert.match(String(statusList[2]?.content), /Todos: none\./);
  await client.send({ type: 'prompt', message: '/poteto-mode off' });
  assert.equal(await client.finish(), 0);
  assert.doesNotMatch(client.stderr, /Failed to load extension|Extension error/);
  process.stdout.write('Verified installed Pi CLI package loading, RPC commands, status, mode off, and orderly shutdown without model calls.\n');
}

const directory = await mkdtemp(join(tmpdir(), 'pi-pstack-cli-'));
try {
  const child = spawn(process.execPath, [cli, '--mode', 'rpc', '--no-session', '-e', root], {
    cwd: directory,
    env: { ...process.env, HOME: directory, PI_CODING_AGENT_DIR: directory },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const client = rpcProcess(child);
  try {
    await verify(client);
  } finally {
    await client.close();
  }
} finally {
  await rm(directory, { recursive: true, force: true });
}
