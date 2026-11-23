#!/usr/bin/env node
/**
 * Real `pi` check: a background completion lands while the parent session file is briefly
 * unwritable. The parent must survive, and the completed run must be persisted once the file is
 * writable again.
 */
import { spawn } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { startFakeModelServer } from '../fixtures/fake-model-server.mjs';

const ZERO = 0;
const TIMEOUT_MS = 60_000;
const CHILD_MARKER = 'APPEND_FAILURE_CHILD';
const scriptDir = dirname(fileURLToPath(import.meta.url));
const extensionPath = resolve(scriptDir, '../../src/index.ts');

let childRequest = ZERO;
let releaseChild;
const waitChild = new Promise((resolveChild) => {
  releaseChild = resolveChild;
});

const server = await startFakeModelServer({
  childMarker: CHILD_MARKER,
  onRequest: async ({ messages, isChild, model, response, streamText, streamToolCall }) => {
    if (isChild) {
      childRequest += 1;
      if (childRequest === 1) {
        streamToolCall(response, model, { id: 'call_read', name: 'read', args: { path: 'marker.txt' } });
        return true;
      }
      releaseChild();
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 400));
      streamText(response, model, 'CHILD_FINISHED');
      return true;
    }
    const hasTool = messages.some((message) => message.role === 'tool');
    if (!hasTool) {
      streamToolCall(response, model, { id: 'call_task', name: 'task', args: { description: 'Append failure probe', prompt: 'Read marker.txt and finish.', subagent_type: 'worker', run_in_background: true } });
      return true;
    }
    setTimeout(() => streamText(response, model, 'PARENT_DONE'), 1600);
    return true;
  },
});

const root = mkdtempSync(join(tmpdir(), 'pi-subagents-append-failure-'));
console.log(`evidence root: ${root}`);
const profile = join(root, 'profile');
const workspace = join(root, 'workspace');
const sessions = join(workspace, 'sessions');
try {
  mkdirSync(profile, { recursive: true });
  mkdirSync(join(workspace, '.pi', 'agents'), { recursive: true });
  mkdirSync(sessions, { recursive: true });
  writeFileSync(join(workspace, 'marker.txt'), 'marker contents\n');
  writeFileSync(join(profile, 'models.json'), JSON.stringify({ providers: { fake: { baseUrl: `${server.url}/v1`, api: 'openai-completions', apiKey: 'k', models: [{ id: 'fake-model', contextWindow: 100000, maxTokens: 4096 }] } } }));
  writeFileSync(join(workspace, '.pi', 'agents', 'worker.md'), ['---', 'name: worker', 'description: Reads one file and finishes.', 'tools: read', '---', CHILD_MARKER].join('\n'));
  const child = spawn('pi', ['-p', '--session-dir', sessions, '-ne', '-e', extensionPath, '-ns', '-np', '--no-themes', '--approve', '--model', 'fake/fake-model', 'Delegate the work to worker.'], {
    cwd: workspace,
    env: { ...process.env, PI_CODING_AGENT_DIR: profile },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (part) => {
    stdout += part;
  });
  child.stderr.on('data', (part) => {
    stderr += part;
  });

  await Promise.race([waitChild, new Promise((resolveTimeout) => setTimeout(resolveTimeout, 30_000))]);
  const parentFile = readdirSync(sessions).find((name) => name.endsWith('.jsonl'));
  if (parentFile === undefined) {
    throw new Error('no parent session file');
  }
  const target = join(sessions, parentFile);
  chmodSync(target, 0o444);
  setTimeout(() => {
    chmodSync(target, 0o644);
  }, 1200);

  const timer = setTimeout(() => child.kill('SIGKILL'), TIMEOUT_MS);
  const status = await new Promise((resolveClose) => child.on('close', resolveClose));
  clearTimeout(timer);
  console.log(`exit=${status}`);
  console.log('stdoutTail:', JSON.stringify(stdout.trim().slice(-200)));
  console.log('stderrTail:', JSON.stringify(stderr.trim().slice(0, 800)));

  const entries = readdirSync(sessions)
    .filter((name) => name.endsWith('.jsonl'))
    .flatMap((name) =>
      readFileSync(join(sessions, name), 'utf8')
        .split('\n')
        .filter((line) => line.trim().length > ZERO)
        .map((line) => JSON.parse(line)),
    );
  const stateEntries = entries.filter((entry) => entry.customType === 'pi-subagents-state');
  const folded = new Map();
  for (const entry of stateEntries) {
    for (const record of entry.data.sessions ?? []) {
      folded.set(record.agentId, record);
    }
  }
  const records = [...folded.values()];
  const sessionText = readFileSync(target, 'utf8');
  const parentSawResult = sessionText.includes('CHILD_FINISHED');
  console.log(`stateEntries=${stateEntries.length} records=${records.length} parentSawResult=${parentSawResult}`);
  console.log('records:', JSON.stringify(records.map((record) => ({ status: record.status, failureId: record.failureId ?? null }))));
  const passed = status === ZERO && parentSawResult && records.some((record) => record.status === 'success' && typeof record.transcriptPath === 'string');
  if (!passed) {
    console.error('FAIL: parent did not survive and persist the completed run');
    process.exitCode = 1;
  } else {
    console.log('PASS: parent survived and persisted the completed run after a write failure');
  }
} finally {
  await server.close();
}
