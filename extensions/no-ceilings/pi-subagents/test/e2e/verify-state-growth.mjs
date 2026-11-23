#!/usr/bin/env node
/** Adversarial: measure parent session file growth across repeated delegated runs. */
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, writeFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startFakeModelServer } from '../fixtures/fake-model-server.mjs';

const ZERO = 0;
const TIMEOUT_MS = 600_000;
const RUNS = Number(process.argv[2] ?? 6);
const READS = Number(process.argv[3] ?? 25);
const CHILD_MARKER = 'DISK_CHILD_MARKER';
const scriptDir = dirname(fileURLToPath(import.meta.url));
const extensionPath = resolve(scriptDir, '../../src/index.ts');
const BIG = 'x'.repeat(1800);
let childRounds = 0;
let parentTasks = 0;

const server = await startFakeModelServer({
  childMarker: CHILD_MARKER,
  onRequest: async ({ messages, isChild, model, response, streamText, streamToolCall }) => {
    const hasTool = messages.some((m) => m.role === 'tool');
    if (isChild) {
      childRounds += 1;
      const toolCount = messages.filter((m) => m.role === 'tool').length;
      if (toolCount < READS) {
        streamToolCall(response, model, { id: `read_${toolCount}`, name: 'read', args: { path: 'big.txt' } });
        return true;
      }
      streamText(response, model, 'child finished');
      return true;
    }
    if (!hasTool) {
      parentTasks += 1;
      streamToolCall(response, model, { id: `task_${parentTasks}`, name: 'task', args: { description: `Batch ${parentTasks}`, prompt: 'Read big.txt many times.', subagent_type: 'worker' } });
      return true;
    }
    if (parentTasks < RUNS) {
      parentTasks += 1;
      streamToolCall(response, model, { id: `task_${parentTasks}`, name: 'task', args: { description: `Batch ${parentTasks}`, prompt: 'Read big.txt many times.', subagent_type: 'worker' } });
      return true;
    }
    streamText(response, model, 'ALL_DONE');
    return true;
  },
});

const root = mkdtempSync(join(tmpdir(), 'pi-subagents-disk-'));
const profile = join(root, 'profile');
const workspace = join(root, 'workspace');
const sessions = join(workspace, 'sessions');
try {
  mkdirSync(profile, { recursive: true });
  mkdirSync(join(workspace, '.pi', 'agents'), { recursive: true });
  mkdirSync(sessions, { recursive: true });
  writeFileSync(join(workspace, 'big.txt'), BIG);
  writeFileSync(join(profile, 'models.json'), JSON.stringify({ providers: { fake: { baseUrl: `${server.url}/v1`, api: 'openai-completions', apiKey: 'k', models: [{ id: 'fake-model', contextWindow: 100000, maxTokens: 4096 }] } } }));
  writeFileSync(join(workspace, '.pi', 'agents', 'worker.md'), ['---', 'name: worker', 'description: Reads a big file many times.', 'tools: read', '---', `${CHILD_MARKER}. Read big.txt repeatedly.`].join('\n'));
  const started = Date.now();
  const child = spawn('pi', ['-p', '--session-dir', sessions, '-ne', '-e', extensionPath, '-ns', '-np', '--no-themes', '--approve', '--model', 'fake/fake-model', 'Delegate the batches.'], {
    cwd: workspace,
    env: { ...process.env, PI_CODING_AGENT_DIR: profile },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  child.stdout.on('data', (p) => {
    stdout += p;
  });
  child.stderr.on('data', (p) => {
    stdout += p;
  });
  const timer = setTimeout(() => child.kill('SIGKILL'), TIMEOUT_MS);
  const status = await new Promise((r) => child.on('close', r));
  clearTimeout(timer);
  const files = readdirSync(sessions).filter((n) => n.endsWith('.jsonl'));
  const total = files.reduce((t, n) => t + statSync(join(sessions, n)).size, 0);
  console.log(`exit=${status} elapsedMs=${Date.now() - started} runs=${parentTasks} childRounds=${childRounds} parentSessionBytes=${total} (${(total / 1048576).toFixed(2)} MiB)`);
  console.log('stdoutTail:', JSON.stringify(stdout.trim().slice(-120)));
  const passed = status === 0 && parentTasks === RUNS && total < 2_000_000;
  if (!passed) {
    console.error(`FAIL: expected ${RUNS} runs, exit 0, and a parent session under 2 MB`);
    process.exitCode = 1;
  } else {
    console.log(`PASS: ${RUNS} runs kept the parent session under 2 MB`);
  }
} finally {
  await server.close();
}
