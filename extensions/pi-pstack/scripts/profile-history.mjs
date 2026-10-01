import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { SessionManager } from '@earendil-works/pi-coding-agent';
import { workspaceHistory } from '../src/history.ts';

const destination = process.argv[2];
const count = Number(process.argv[3] ?? 200);
if (!destination || !Number.isSafeInteger(count) || count < 2 || count > 5000) throw new Error('Usage: node profile-history.mjs <fresh-output-directory> [session-count 2..5000]');
await mkdir(resolve(destination));
const controller = new AbortController();
const interrupt = () => controller.abort(new Error('History profiling interrupted'));
process.on('SIGINT', interrupt);
process.on('SIGTERM', interrupt);
const root = await mkdtemp(join(tmpdir(), 'pstack-profile-history-'));
const directory = join(root, 'sessions');
const cwd = join(root, 'workspace');
const runs = [];
try {
  await mkdir(directory);
  for (let index = 0; index < count; index++) {
    controller.signal.throwIfAborted();
    const header = { type: 'session', version: 3, id: `fixture-${index}`, cwd: index % 2 ? join(root, 'other') : cwd, timestamp: '2026-01-01T00:00:00Z' };
    const entry = { type: 'message', id: `message-${index}`, parentId: null, timestamp: '2026-01-01T00:00:01Z', message: { role: 'user', content: 'Synthetic profile fixture. '.repeat(64) } };
    await writeFile(join(directory, `${index}.jsonl`), `${JSON.stringify(header)}\n${JSON.stringify(entry)}\n`);
  }
  for (let repeat = 0; repeat < 3; repeat++) {
    for (const name of repeat % 2 ? ['gated', 'sdk'] : ['sdk', 'gated']) {
      const before = process.memoryUsage();
      const cpu = process.cpuUsage();
      const started = performance.now();
      const sessions = name === 'sdk' ? await SessionManager.list(cwd, directory, undefined, controller.signal) : await workspaceHistory(cwd, directory, controller.signal);
      const elapsedMs = performance.now() - started;
      assert.equal(sessions.length, Math.ceil(count / 2));
      assert.ok(sessions.every(({ id }) => Number(id.slice('fixture-'.length)) % 2 === 0));
      runs.push({ name, repeat, elapsedMs, cpuMicros: process.cpuUsage(cpu), beforeMemory: before, afterMemory: process.memoryUsage(), returned: sessions.length });
    }
  }
  controller.signal.throwIfAborted();
  const median = (name) =>
    runs
      .filter((run) => run.name === name)
      .map(({ elapsedMs }) => elapsedMs)
      .toSorted((a, b) => a - b)[1];
  await writeFile(
    join(resolve(destination), 'results.json'),
    `${JSON.stringify({ node: process.version, platform: process.platform, count, runs, medianMs: { sdk: median('sdk'), gated: median('gated') }, ratio: median('gated') / median('sdk'), scope: 'Synthetic current-format shared-root discovery in one process. Alternating order, three repetitions. Memory snapshots are not peak memory or leak proof. SDK reads foreign bodies; returned scope assertions do not imply SDK body isolation. No cold-cache, adversarial or cross-platform equivalence claim.' }, null, 2)}\n`,
  );
} finally {
  try {
    await rm(root, { recursive: true, force: true });
  } finally {
    process.off('SIGINT', interrupt);
    process.off('SIGTERM', interrupt);
  }
}
