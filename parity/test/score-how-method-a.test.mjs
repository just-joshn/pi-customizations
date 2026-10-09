import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

import { expect, test } from 'vitest';

import { runCli, scorePlaintext } from '../scripts/score-how-method-a.mjs';

const execute = promisify(execFile);
const cli = fileURLToPath(new URL('../scripts/score-how-method-a.mjs', import.meta.url));

const out = (seq, text) => ({
  seq,
  kind: 'output',
  monoNs: String(seq),
  utc: new Date(0).toISOString(),
  dataB64: Buffer.from(text).toString('base64'),
});

async function writeAttempt(events) {
  const dir = join(tmpdir(), `how-method-a-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, 'identity.json'),
    `${JSON.stringify({ schema: 1, attemptId: 'test', side: 'fixture' }, null, 2)}\n`,
  );
  await writeFile(join(dir, 'events.jsonl'), `${events.map((event) => JSON.stringify(event)).join('\n')}\n`);
  return dir;
}

test('scorePlaintext passes on Running subagent chrome', () => {
  const report = scorePlaintext('status\n  Running subagent  5.8k tokens\n');
  expect(report.pass).toBe(true);
  expect(report.signals.runningSubagent.found).toBe(true);
});

test('scorePlaintext passes on Task tool chrome without Running subagent', () => {
  const report = scorePlaintext('Explored available MCP tools cursor · Task\n');
  expect(report.pass).toBe(true);
  expect(report.signals.taskTool.found).toBe(true);
  expect(report.signals.runningSubagent.found).toBe(false);
});

test('scorePlaintext fails when Task appears only in prose', () => {
  const report = scorePlaintext('No Task spawn. I used greps instead of spawning explainer agents.\n');
  expect(report.pass).toBe(false);
  expect(report.signals.taskTool.found).toBe(false);
  expect(report.signals.runningSubagent.found).toBe(false);
});

test('scorePlaintext passes on Pi session toolCall name task', () => {
  const report = scorePlaintext(
    JSON.stringify({
      type: 'message',
      message: {
        role: 'assistant',
        content: [{ type: 'toolCall', id: 'toolu_1', name: 'task', arguments: { agent_type: 'explore' } }],
      },
    }),
  );
  expect(report.pass).toBe(true);
  expect(report.signals.taskTool.found).toBe(true);
});

test('scorePlaintext passes on Pi subagent.started custom event', () => {
  const report = scorePlaintext(
    JSON.stringify({
      type: 'custom',
      customType: 'reference-assistant-event',
      data: { type: 'subagent.started', data: { agentName: 'explore' } },
    }),
  );
  expect(report.pass).toBe(true);
  expect(report.signals.taskTool.found).toBe(true);
});

test('scorePlaintext ignores tools-schema name task without toolCall', () => {
  const report = scorePlaintext(
    JSON.stringify({
      name: 'task',
      description: 'Launch specialized agents in separate context windows for specific tasks.',
    }),
  );
  expect(report.pass).toBe(false);
  expect(report.signals.taskTool.found).toBe(false);
});

test('scorePlaintext reports READONLY and gate block reason when present', () => {
  const report = scorePlaintext('Task READONLY\nBlocked by approval gate: needs owner\n');
  expect(report.signals.readonlyExplainer.found).toBe(true);
  expect(report.signals.gateBlockReason.found).toBe(true);
  expect(report.signals.gateBlockReason.reason).toMatch(/Blocked by approval gate/i);
});

test('CLI exits 0 on synthetic pass attempt', async () => {
  const dir = await writeAttempt([out(0, 'Running subagent\n')]);
  const result = await runCli([dir]);
  expect(result.exitCode).toBe(0);
  expect(result.report.pass).toBe(true);
});

test('CLI exits 1 on synthetic fail attempt', async () => {
  const dir = await writeAttempt([out(0, 'answered with greps only\n')]);
  const result = await runCli([dir]);
  expect(result.exitCode).toBe(1);
  expect(result.report.pass).toBe(false);
});

test('CLI exits 2 on missing attempt dir', async () => {
  const result = await runCli(['/tmp/does-not-exist-how-method-a']);
  expect(result.exitCode).toBe(2);
  expect(result.report.error).toMatch(/bad attempt dir/i);
});

test('CLI process exit codes match runCli for usage error', async () => {
  try {
    await execute(process.execPath, [cli]);
    expect.unreachable('expected non-zero exit');
  } catch (error) {
    expect(error.code).toBe(2);
    expect(JSON.parse(error.stdout).error).toMatch(/usage:/i);
  }
});

test('CLI reads method-a-session.json session pointer for Pi Task', async () => {
  const sessionDir = join(tmpdir(), `how-method-a-session-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  await mkdir(sessionDir, { recursive: true });
  const sessionPath = join(sessionDir, 'parent.jsonl');
  await writeFile(
    sessionPath,
    `${JSON.stringify({
      type: 'message',
      message: {
        role: 'assistant',
        content: [{ type: 'toolCall', id: 't1', name: 'task', arguments: {} }],
      },
    })}\n`,
  );
  const dir = await writeAttempt([out(0, 'pi chrome without Running subagent\n')]);
  await writeFile(join(dir, 'method-a-session.json'), `${JSON.stringify({ session: sessionPath }, null, 2)}\n`);
  const result = await runCli([dir]);
  expect(result.exitCode).toBe(0);
  expect(result.report.pass).toBe(true);
  expect(result.report.signals.taskTool.found).toBe(true);
});

test('CLI --session path scores Pi Task when PTY has no chrome', async () => {
  const sessionDir = join(tmpdir(), `how-method-a-flag-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  await mkdir(sessionDir, { recursive: true });
  const sessionPath = join(sessionDir, 'parent.jsonl');
  await writeFile(
    sessionPath,
    `${JSON.stringify({
      type: 'custom',
      customType: 'reference-assistant-event',
      data: { type: 'subagent.started' },
    })}\n`,
  );
  const dir = await writeAttempt([out(0, 'pi chrome without Running subagent\n')]);
  const result = await runCli([dir, '--session', sessionPath]);
  expect(result.exitCode).toBe(0);
  expect(result.report.pass).toBe(true);
});
