import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

import { readJson, writeRaw } from './pstack-env-lib.js';

const PACKAGE = 'extensions/pi-pstack';

function waitForValue(probe, { timeoutMs = 60000, description = 'a value' } = {}) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const poll = () => {
      Promise.resolve()
        .then(probe)
        .then((value) => {
          if (value !== undefined) resolve(value);
          else if (Date.now() > deadline) reject(new Error(`Timed out after ${timeoutMs}ms waiting for ${description}`));
          else setTimeout(poll, 50);
        })
        .catch(reject);
    };
    poll();
  });
}

function bareRpc(context, { agentDir, cwd }) {
  const child = spawn(context.piBin, ['--mode', 'rpc', '--no-session'], {
    cwd,
    env: { ...process.env, PI_CODING_AGENT_DIR: agentDir, PI_OFFLINE: '1', PI_SKIP_VERSION_CHECK: '1' },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const records = [];
  let buffer = '';
  let stderr = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk) => {
    stderr += chunk;
  });
  child.stdout.on('data', (chunk) => {
    buffer += chunk;
    let at = buffer.indexOf('\n');
    while (at >= 0) {
      const line = buffer.slice(0, at).replace(/\r$/, '');
      buffer = buffer.slice(at + 1);
      if (line) {
        try {
          records.push(JSON.parse(line));
        } catch {
          records.push({ type: 'unparsed', line });
        }
      }
      at = buffer.indexOf('\n');
    }
  });
  let sequence = 0;
  async function call(command) {
    const id = `bare-${++sequence}`;
    child.stdin.write(`${JSON.stringify({ id, ...command })}\n`);
    return waitForValue(() => records.find((record) => record.type === 'response' && record.id === id), { description: `${command.type} response` });
  }
  async function close() {
    if (child.exitCode === null && child.signalCode === null) {
      child.stdin.end();
      await waitForValue(() => (child.exitCode === null && child.signalCode === null ? undefined : true), { description: 'bare pi exit', timeoutMs: 10000 }).catch(() => child.kill('SIGKILL'));
    }
    if (child.exitCode === null && child.signalCode === null) throw new Error('bare pi did not exit');
  }
  return { records, call, close, stderr: () => stderr };
}

function run(context, args, { agentDir, cwd }) {
  const result = spawnSync(context.piBin, args, { cwd, encoding: 'utf8', env: { ...process.env, PI_CODING_AGENT_DIR: agentDir, PI_OFFLINE: '1', PI_SKIP_VERSION_CHECK: '1' } });
  return { status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

export default async function pstackConfigInstall(context) {
  const agentDir = join(context.scratchDir, 'install-agent');
  mkdirSync(agentDir, { recursive: true });
  const packageDir = join(context.repoRoot, PACKAGE);
  const install = run(context, ['install', packageDir], { agentDir, cwd: agentDir });
  const settings = readJson(join(agentDir, 'settings.json'));
  const listed = run(context, ['list'], { agentDir, cwd: agentDir });

  const session = bareRpc(context, { agentDir, cwd: agentDir });
  let commands;
  let status;
  try {
    commands = (await session.call({ type: 'get_commands' })).data.commands.map((command) => command.name);
    await session.call({ type: 'prompt', message: '/pstack status' });
    await waitForValue(() => session.records.find((record) => record.type === 'message_end' && record.message?.customType === 'pstack-status'), { description: 'the pstack status message' });
    status = session.records
      .filter((record) => record.type === 'message_end' && record.message?.customType === 'pstack-status')
      .map((record) => (typeof record.message.content === 'string' ? record.message.content : ''))
      .at(-1);
  } finally {
    await session.close();
  }
  const manifest = readJson(join(packageDir, 'package.json'));
  const capture = writeRaw(context, 'install-manifest.json', {
    install: { code: install.status, stdout: install.stdout.slice(0, 400), stderr: install.stderr.slice(0, 400) },
    settings,
    list: listed.stdout.slice(0, 400),
    commands: commands.filter((name) => ['pstack', 'goal', 'setup-pstack', 'poteto-mode'].includes(name)),
    status,
    pi: manifest.pi,
  });
  context.receipts.assertVerdict({
    surfaceId: 'PS-INSTALL-1',
    package: PACKAGE,
    expected: 'Loads one extension, 71 skills, 69 prompts, remote package image',
    observed: `pi install exit=${install.status} wrote packages=${JSON.stringify(settings.packages)}; pi list printed ${JSON.stringify(listed.stdout.trim().slice(0, 120))}; a session started without -e had commands ${JSON.stringify(commands.filter((name) => ['pstack', 'goal', 'setup-pstack', 'poteto-mode'].includes(name)))} and /pstack status reported ${JSON.stringify(status?.split('\n').find((line) => line.includes('skills')))}; the manifest image field is ${JSON.stringify(manifest.pi.image)} (not fetched: no network)`,
    evidence: capture,
    check: () => {
      assert.equal(install.status, 0, `pi install failed: ${install.stderr}`);
      assert.ok(
        settings.packages?.some((registered) => String(registered).includes('pi-pstack')),
        'settings.json did not register the package',
      );
      assert.ok(commands.includes('pstack'), 'the installed package extension did not register /pstack');
      assert.ok(existsSync(join(packageDir, 'src/index.ts')), 'the manifest entry point is missing');
      assert.match(status ?? '', /71 skills, 69 prompt templates/, 'the installed package did not load its skills and prompts');
      assert.match(String(manifest.pi.image ?? ''), /^https:\/\//, 'the manifest has no remote package image');
    },
  });
  context.log('✓ pstack-config-install wrote 1 receipt (PS-INSTALL-1)');
}
