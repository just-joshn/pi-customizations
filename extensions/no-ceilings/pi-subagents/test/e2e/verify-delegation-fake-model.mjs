#!/usr/bin/env node
/**
 * Deterministic end-to-end check of delegation through the real `pi` CLI.
 *
 * The CLI loads the extension from source, discovers a project agent, and runs a real parent and
 * child AgentSession with real tools. The model is a local OpenAI-compatible server that always
 * returns the same tool calls, so this needs no credentials and cannot flake on model output.
 *
 * Usage:
 *   node test/e2e/verify-delegation-fake-model.mjs
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { startFakeModelServer } from '../fixtures/fake-model-server.mjs';

const ZERO = 0;
const ONE = 1;
const TIMEOUT_MS = 120_000;
const MARKER = 'deterministic-marker-5f31';
const CHILD_MARKER = 'FAKE_CHILD_MARKER';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const extensionPath = resolve(scriptDir, '../../src/index.ts');

function fail(message) {
  console.error(`FAIL ${message}`);
  process.exit(ONE);
}

function runPi(args, cwd, env) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn('pi', args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`pi did not finish within ${TIMEOUT_MS}ms. stdout:\n${stdout}\nstderr:\n${stderr}\nrequests: ${server.requests.length}`));
    }, TIMEOUT_MS);
    child.stdout.on('data', (part) => {
      stdout += part;
    });
    child.stderr.on('data', (part) => {
      stderr += part;
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (status) => {
      clearTimeout(timer);
      resolvePromise({ status, stdout, stderr });
    });
  });
}

function readJsonLines(path) {
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter((line) => line.trim().length > ZERO)
    .map((line) => JSON.parse(line));
}

const server = await startFakeModelServer({ childMarker: CHILD_MARKER });
const root = mkdtempSync(join(tmpdir(), 'pi-subagents-fake-e2e-'));
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
        fake: {
          baseUrl: `${server.url}/v1`,
          api: 'openai-completions',
          apiKey: 'fake-key',
          models: [{ id: 'fake-model', contextWindow: 100_000, maxTokens: 4096 }],
        },
      },
    }),
  );
  writeFileSync(join(workspace, 'marker.txt'), `${MARKER}\n`);
  writeFileSync(
    join(workspace, '.pi', 'agents', 'worker.md'),
    ['---', 'name: worker', 'description: Reads one file and reports its contents.', 'tools: read', '---', `${CHILD_MARKER}. Read the requested file and report its contents.`].join('\n'),
  );

  console.log(`evidence root: ${root}`);
  const result = await runPi(
    ['-p', '--session-dir', sessions, '-ne', '-e', extensionPath, '-ns', '-np', '--no-themes', '--approve', '--model', 'fake/fake-model', 'Delegate this work to the worker subagent, then report its result.'],
    workspace,
    { ...process.env, PI_CODING_AGENT_DIR: profile },
  );
  if (result.error) {
    fail(`pi could not start: ${result.error.message}`);
  }
  if (result.status !== ZERO) {
    console.error(result.stdout);
    console.error(result.stderr);
    fail(`pi exited ${result.status}`);
  }
  const expected = 'PARENT_SAW:CHILD_SAW:' + MARKER;
  if (!result.stdout.includes(expected)) {
    fail(`parent reply missing "${expected}": ${result.stdout}`);
  }
  console.log(`ok parent reply contains ${expected}`);

  if (server.requests.length < 4) {
    fail(`expected four model requests (parent task, child read, child result, parent result), got ${server.requests.length}`);
  }
  const childRequests = server.requests.filter((request) => request.messages.some((message) => message.role === 'system' && String(message.content).includes(CHILD_MARKER)));
  if (childRequests.length !== 2) {
    fail(`expected two child requests, got ${childRequests.length}`);
  }
  console.log(`ok fake model served ${server.requests.length} requests, including two child turns`);

  const parentFiles = readdirSync(sessions).filter((name) => name.endsWith('.jsonl'));
  if (parentFiles.length === ZERO) {
    fail('no parent session file was written');
  }
  const parentEntries = parentFiles.flatMap((name) => readJsonLines(join(sessions, name)));
  const text = JSON.stringify(parentEntries);
  if (!text.includes('"name":"task"')) {
    fail('parent session has no task tool call');
  }
  if (!text.includes('CHILD_SAW:')) {
    fail('parent session has no child result');
  }
  console.log('ok parent session trace has the task call and the child result');

  const childDir = join(sessions, 'subagents');
  if (!existsSync(childDir)) {
    fail('no child transcript directory');
  }
  const childFiles = readdirSync(childDir).filter((name) => name.endsWith('.jsonl'));
  if (childFiles.length === ZERO) {
    fail('no child transcript file');
  }
  const childText = childFiles.map((name) => readFileSync(join(childDir, name), 'utf8')).join('\n');
  if (!childText.includes('"name":"read"') || !childText.includes(MARKER)) {
    fail('child transcript is missing the read call or the file contents');
  }
  console.log('ok child transcript has the read call and the file contents');

  const snapshots = parentEntries.filter((entry) => entry.customType === 'pi-subagents-state').flatMap((entry) => entry.data.sessions);
  if (!snapshots.some((session) => session.transcriptPath && session.status === 'success')) {
    fail('persisted state has no completed run with a transcript path');
  }
  console.log('ok persisted state has a completed run with a transcript path');

  console.log(`PASS ${root}`);
} finally {
  await server.close();
}
