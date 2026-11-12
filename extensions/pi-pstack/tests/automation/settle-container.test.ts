import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, expect, test } from 'vitest';
import { workerDir } from '../../src/automation/dispatch.ts';
import type { RunId } from '../../src/automation/model.ts';
import { collectRun } from '../../src/automation/settle.ts';

let root: string | undefined;
afterEach(() => root !== undefined && rmSync(root, { recursive: true, force: true }));

const RUN = 'auto-container0001' as RunId;
const message = (text: string) => `${JSON.stringify({ type: 'message', message: { role: 'assistant', content: [{ type: 'text', text }] } })}\n`;

/** A settled container worker: its session lives under `out/session`, which the worker owns, and `session` is the link the host reads it through. */
function containerWorker(): { out: string; sessionFile: string } {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'settle-container-')));
  const worker = workerDir(root, RUN);
  mkdirSync(join(worker, 'out', 'session'), { recursive: true });
  symlinkSync(join('out', 'session'), join(worker, 'session'));
  writeFileSync(join(worker, 'assignment.json'), JSON.stringify({ schemaVersion: 1, runId: RUN, workerId: 'owner', kind: 'pi', role: 'owner', brief: 'brief.md', model: 'inherit-parent', thinkingLevel: null, workspace: { mode: 'container', inputCommit: 'a'.repeat(40) }, skills: [], capabilities: { mcp: 'none', env: 'minimal', externalWrite: false } }));
  mkdirSync(join(root, '.pi/pstack/runs', RUN), { recursive: true });
  writeFileSync(join(root, '.pi/pstack/runs', RUN, 'run.json'), JSON.stringify({ schemaVersion: 1, runId: RUN, title: 't', playbook: 'p', upstreamRevision: 'x', createdAt: new Date().toISOString(), parentSessionFile: null, inputCommit: 'a'.repeat(40) }));
  const sessionFile = join(worker, 'session', 'fake.jsonl');
  const state = { schemaVersion: 1, runId: RUN, workerId: 'owner', kind: 'pi', digest: 'x', instance: 'i1', hostPid: 2 ** 22 - 1, childPid: null, tmuxSession: 's', socketPath: '/nonexistent', phase: 'idle', reason: null, model: null, sessionFile, briefSent: true, generation: 1, settles: [{ sequence: 1, generation: 1, phase: 'idle', reason: null, at: new Date().toISOString() }], exit: null, updatedAt: new Date().toISOString() };
  writeFileSync(join(worker, 'state.json'), JSON.stringify(state));
  return { out: join(worker, 'out'), sessionFile };
}

const collect = () => collectRun(root as string, RUN, async () => Promise.reject(new Error('no host')));

test('a container worker\'s final message is read from its own output directory', async () => {
  const { out } = containerWorker();
  writeFileSync(join(out, 'session', 'fake.jsonl'), message('Verdict.\n[benny:other]'));
  expect(await collect()).toMatchObject({ settled: true, failure: null, finalText: 'Verdict.\n[benny:other]' });
});

test('a session file the container worker swapped for a symlink is not followed, so its target is never read as the result', async () => {
  const { out } = containerWorker();
  const secret = join(root as string, 'secret.jsonl');
  writeFileSync(secret, message('A message from outside the worker output.\n[benny:bug]'));
  symlinkSync(secret, join(out, 'session', 'fake.jsonl'));
  expect(await collect()).toMatchObject({ settled: true, failure: 'the worker produced no final message', finalText: null });
});

test('a torn last line in a session file does not hide the message before it', async () => {
  const { out } = containerWorker();
  writeFileSync(join(out, 'session', 'fake.jsonl'), `${message('First.')}{"type":"message","mess`);
  expect(await collect()).toMatchObject({ settled: true, finalText: 'First.' });
});
