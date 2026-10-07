#!/usr/bin/env node
// Loads two sets of packages into one Pi session each and reports what registers, so the
// cross-extension claim is rerunnable rather than remembered. Writes artifacts/baseline/cross-extension.txt.
import { execFileSync, spawn } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../../..', import.meta.url));
const scratch = mkdtempSync(join(tmpdir(), 'cross-extension-'));
const lines = [];

function auth() {
  const fixture = {
    'claude-subscription': { type: 'oauth', access: 'sk-ant-oat01-fixture', refresh: 'fixture', expires: 9999999999999 },
    'google-antigravity': { type: 'oauth', access: 'ya29.fixture', refresh: 'fixture', expires: 9999999999999, projectId: 'fixture', email: 'fixture@example.invalid' },
    'grok-build': { type: 'oauth', access: 'fixture', refresh: 'fixture', expires: 9999999999999 },
  };
  const path = join(scratch, 'auth.json');
  writeFileSync(path, JSON.stringify(fixture));
  chmodSync(path, 0o600);
}

function providers() {
  const packages = ['pi-anthropic-oauth', 'pi-antigravity-oauth', 'pi-xai-oauth'].map((name) => join(ROOT, 'extensions', name));
  const args = ['--no-session', '--no-extensions', ...packages.flatMap((path) => ['-e', path]), '--list-models'];
  const out = execFileSync('pi', args, { cwd: scratch, env: { ...process.env, PI_CODING_AGENT_DIR: scratch }, encoding: 'utf8', timeout: 180_000 });
  const counts = new Map();
  for (const line of out.split('\n')) {
    const provider = line.trim().split(/\s+/)[0];
    if (['claude-subscription', 'google-antigravity', 'grok-build'].includes(provider)) counts.set(provider, (counts.get(provider) ?? 0) + 1);
  }
  lines.push(`three subscription providers together: ${[...counts].map(([name, count]) => `${name}=${count}`).join(', ')}`);
}

function commands() {
  const packages = ['pi-pstack', 'pi-tui-skin'].map((name) => join(ROOT, 'extensions', name));
  const child = spawn('pi', ['--mode', 'rpc', '--no-session', '--no-extensions', ...packages.flatMap((path) => ['-e', path])], {
    cwd: scratch,
    env: { ...process.env, PI_CODING_AGENT_DIR: scratch },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  child.stdin.write(`${JSON.stringify({ id: '1', type: 'get_commands' })}\n`);
  return new Promise((resolve) => {
    let buffer = '';
    const done = () => {
      child.kill();
      resolve();
    };
    child.stdout.on('data', (chunk) => {
      buffer += chunk;
      let boundary = buffer.indexOf('\n');
      while (boundary >= 0) {
        const line = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 1);
        boundary = buffer.indexOf('\n');
        let record;
        try {
          record = JSON.parse(line);
        } catch {
          continue;
        }
        if (record.id !== '1' || !record.data) continue;
        const commands = record.data.commands ?? [];
        const extension = commands.filter((command) => command.source === 'extension').map((command) => command.name);
        const pstackNames = ['pstack', 'poteto-mode', 'tasks', 'goal'];
        lines.push(`pi-pstack and pi-tui-skin together: ${commands.length} commands, ${extension.length} extension commands, pstack intact=${pstackNames.every((name) => extension.includes(name))}`);
        done();
        return;
      }
    });
    setTimeout(done, 60_000);
  });
}

try {
  auth();
  providers();
  await commands();
} finally {
  rmSync(scratch, { recursive: true, force: true });
}

console.log(lines.join('\n'));
const outDir = join(ROOT, 'artifacts/baseline');
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'cross-extension.txt'), `${lines.join('\n')}\n`);
