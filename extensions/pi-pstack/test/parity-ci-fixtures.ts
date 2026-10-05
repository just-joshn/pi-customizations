import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';

import { Type } from 'typebox';
import { Check } from 'typebox/value';
import { afterEach, onTestFinished, vi } from 'vitest';
import { timerCommand, timerRecord } from '../scripts/timer-client.mjs';

afterEach(() => vi.unstubAllEnvs());

export type FakeCheck = { name: string; bucket: 'pass' | 'fail' | 'pending' | 'skipping' | 'cancel' };
export type FakeForge = { head: string; prState?: 'OPEN' | 'MERGED' | 'CLOSED'; checks: FakeCheck[]; broken?: boolean };

const GH = `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
fs.appendFileSync(process.env.FAKE_GH_LOG, args.join(' ') + '\\n');
const state = JSON.parse(fs.readFileSync(process.env.FAKE_GH_STATE, 'utf8'));
if (state.broken) { process.stderr.write('HTTP 502: Bad Gateway'); process.exit(1); }
if (args[0] === 'pr' && args[1] === 'view') {
  process.stdout.write(JSON.stringify({ headRefOid: state.head, state: state.prState ?? 'OPEN', url: 'https://github.com/o/r/pull/' + args[2] }));
  process.exit(0);
}
if (args[0] === 'pr' && args[1] === 'checks') {
  if (!state.checks.length) { process.stderr.write("no checks reported on the 'feature' branch"); process.exit(1); }
  process.stdout.write(JSON.stringify(state.checks.map((check) => ({ ...check, state: check.bucket.toUpperCase(), link: 'https://ci.invalid/' + check.name }))));
  process.exit(state.checks.some((check) => check.bucket === 'pending') ? 8 : state.checks.some((check) => check.bucket === 'fail') ? 1 : 0);
}
process.exit(2);
`;

export async function fakeForge(initial: FakeForge) {
  const directory = await mkdtemp(join(tmpdir(), 'pstack-ci-forge-'));
  onTestFinished(() => rm(directory, { recursive: true, force: true }));
  const bin = join(directory, 'bin');
  await writeFile(join(directory, 'state.json'), JSON.stringify(initial));
  await writeFile(join(directory, 'calls.log'), '');
  await mkdir(bin);
  await writeFile(join(bin, 'gh'), GH);
  await chmod(join(bin, 'gh'), 0o755);
  vi.stubEnv('PATH', `${bin}${delimiter}${process.env['PATH']}`);
  vi.stubEnv('FAKE_GH_STATE', join(directory, 'state.json'));
  vi.stubEnv('FAKE_GH_LOG', join(directory, 'calls.log'));
  return {
    directory,
    set: (next: FakeForge) => writeFile(join(directory, 'state.json'), JSON.stringify(next)),
    calls: async () => (await readFile(join(directory, 'calls.log'), 'utf8')).split('\n').filter(Boolean),
  };
}

const ReadyService = Type.Object({ kind: Type.Literal('ready') });

export async function stopTimerOwner(directory: string): Promise<void> {
  if (Check(ReadyService, await timerRecord(join(directory, 'status.json')))) await timerCommand(directory, { type: 'shutdown' });
}

export async function timerOwner(prefix: string) {
  const directory = await mkdtemp(join(tmpdir(), `pstack-${prefix}-`));
  onTestFinished(async () => {
    await stopTimerOwner(directory);
    await rm(directory, { recursive: true, force: true });
  });
  return directory;
}

export async function userEntries(sessionFile: string, needle: string): Promise<string[]> {
  const entries = (await readFile(sessionFile, 'utf8'))
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));
  return entries
    .filter((entry) => entry.type === 'message' && entry.message.role === 'user')
    .map((entry) => JSON.stringify(entry.message.content))
    .filter((text) => text.includes(needle));
}
