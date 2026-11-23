#!/usr/bin/env node
/**
 * Adversarial repro: `pi -p` with a failing subagent and max_attempts > 1.
 * The fake model issues one task call; every child request fails with HTTP 500.
 * Config sets a long retry delay so we can tell whether the process survives the delay.
 */
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { startFakeModelServer } from '../fixtures/fake-model-server.mjs';

const ZERO = 0;
const ONE = 1;
const TIMEOUT_MS = 30_000;
const CHILD_MARKER = 'RETRY_CHILD_MARKER';

const scenario = process.argv[2] ?? 'retry';
const scriptDir = dirname(fileURLToPath(import.meta.url));
const extensionPath = resolve(scriptDir, '../../src/index.ts');

let childRequests = ZERO;
const server = await startFakeModelServer({
  childMarker: CHILD_MARKER,
  onRequest: async ({ messages, isChild, model, response, streamText, streamToolCall }) => {
    if (isChild) {
      childRequests += 1;
      response.writeHead(500, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ error: { message: 'deliberate child failure' } }));
      return true;
    }
    const hasTool = messages.some((message) => message.role === 'tool');
    if (hasTool) {
      const toolText = [...messages].reverse().find((message) => message.role === 'tool');
      streamText(response, model, `PARENT_TOOL:${typeof toolText?.content === 'string' ? toolText.content : JSON.stringify(toolText?.content ?? '')}`);
      return true;
    }
    streamToolCall(response, model, {
      id: 'call_parent_task',
      name: 'task',
      args: { description: 'Retry probe', prompt: 'fail please', subagent_type: 'worker', max_attempts: scenario === 'single' ? 1 : 3 },
    });
    return true;
  },
});

const root = mkdtempSync(join(tmpdir(), 'pi-subagents-retry-repro-'));
const profile = join(root, 'profile');
const workspace = join(root, 'workspace');
const sessions = join(workspace, 'sessions');
try {
  mkdirSync(profile, { recursive: true });
  mkdirSync(join(workspace, '.pi', 'agents'), { recursive: true });
  mkdirSync(sessions, { recursive: true });
  writeFileSync(
    join(profile, 'models.json'),
    JSON.stringify({
      providers: {
        fake: { baseUrl: `${server.url}/v1`, api: 'openai-completions', apiKey: 'fake-key', models: [{ id: 'fake-model', contextWindow: 100_000, maxTokens: 4096 }] },
      },
    }),
  );
  if (scenario === 'zero-delay') {
    writeFileSync(join(profile, 'subagents.json'), JSON.stringify({ retry: { maxAttempts: 3, delayMs: 0 } }));
  }
  // scenario=retry uses the built-in default retry delay (250ms): no config file.
  writeFileSync(
    join(workspace, '.pi', 'agents', 'worker.md'),
    ['---', 'name: worker', 'description: Reads one file and reports its contents.', 'tools: read', '---', `${CHILD_MARKER}. Read the requested file and report its contents.`].join('\n'),
  );

  const started = Date.now();
  const child = spawn('pi', ['-p', '--session-dir', sessions, '-ne', '-e', extensionPath, '-ns', '-np', '--no-themes', '--approve', '--model', 'fake/fake-model', 'Delegate this work to the worker subagent.'], {
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
  const timer = setTimeout(() => child.kill('SIGKILL'), TIMEOUT_MS);
  const status = await new Promise((resolveStatus) => {
    child.on('close', resolveStatus);
  });
  clearTimeout(timer);
  const parentFiles = readdirSync(sessions).filter((name) => name.endsWith('.jsonl'));
  const parentBytes = parentFiles.reduce((total, name) => total + statSync(join(sessions, name)).size, ZERO);
  const states = parentFiles
    .flatMap((name) =>
      readFileSync(join(sessions, name), 'utf8')
        .split('\n')
        .filter((line) => line.trim().length > 0)
        .map((line) => JSON.parse(line)),
    )
    .filter((entry) => entry.customType === 'pi-subagents-state')
    .flatMap((entry) => entry.data.sessions);
  console.log(`scenario=${scenario} exit=${status} elapsedMs=${Date.now() - started} childModelRequests=${childRequests} parentSessionBytes=${parentBytes}`);
  console.log('stdout:', JSON.stringify(stdout.trim().slice(0, 600)));
  console.log('stderr:', JSON.stringify(stderr.trim().slice(0, 300)));
  console.log('persisted:', JSON.stringify(states.map((s) => ({ status: s.status, attempts: s.attempts, code: s.errorCode, error: String(s.error ?? '').slice(0, 80) }))));
  const expectedAttempts = scenario === 'single' ? 1 : 3;
  const finalized = states.some((s) => s.status === 'error' && s.attempts === expectedAttempts);
  const passed = status === 0 && childRequests === expectedAttempts && stdout.includes(`attempts: ${expectedAttempts}/${expectedAttempts}`) && finalized;
  if (!passed) {
    console.error(`FAIL scenario=${scenario}: expected exit 0, ${expectedAttempts} child requests, a returned failure, and a finalized error record`);
    process.exitCode = 1;
  } else {
    console.log(`PASS scenario=${scenario}`);
  }
} finally {
  await server.close();
}
