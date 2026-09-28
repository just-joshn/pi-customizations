import { type ChildProcessWithoutNullStreams, spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { RpcCommand, RpcExtensionUIResponse } from '@earendil-works/pi-coding-agent';
import { type Static, Type } from 'typebox';
import { Check } from 'typebox/value';
import { expect, test } from 'vitest';

const packageRoot = fileURLToPath(new URL('../', import.meta.url));
const dialogDeadlineMs = 4000;
const Select = Type.Object({ type: Type.Literal('extension_ui_request'), id: Type.String(), method: Type.Literal('select'), title: Type.String(), options: Type.Array(Type.String()) });
const End = Type.Object({
  type: Type.Literal('tool_execution_end'),
  toolName: Type.Literal('AskQuestion'),
  isError: Type.Boolean(),
  result: Type.Object({
    content: Type.Array(
      Type.Object({
        type: Type.Literal('text'),
        text: Type.String(),
      }),
    ),
    details: Type.Unknown(),
  }),
});
const Event = Type.Object({ type: Type.String() });
type Outcome = { dialogs: Static<typeof Select>[]; results: Static<typeof End>[]; settled: boolean };

function send(child: ChildProcessWithoutNullStreams, message: RpcCommand | RpcExtensionUIResponse): void {
  child.stdin.write(`${JSON.stringify(message)}\n`);
}

function readRecords(child: ChildProcessWithoutNullStreams, accept: (value: unknown) => void, fail: (error: Error) => void): void {
  let buffer = '';
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (data: string) => {
    buffer += data;
    let boundary = buffer.indexOf('\n');
    while (boundary >= 0) {
      const line = buffer.slice(0, boundary).replace(/\r$/, '');
      buffer = buffer.slice(boundary + 1);
      try {
        if (line) accept(JSON.parse(line));
      } catch (error) {
        fail(error instanceof Error ? error : new Error(String(error)));
      }
      boundary = buffer.indexOf('\n');
    }
  });
}

function exchange(child: ChildProcessWithoutNullStreams, cancelled: boolean): Promise<Outcome> {
  return new Promise((resolve, reject) => {
    let outcome: Outcome = { dialogs: [], results: [], settled: false };
    let failure: Error | undefined;
    let stderr = '';
    const fail = (error: Error) => {
      failure = error;
      child.kill('SIGKILL');
    };
    const timer = setTimeout(() => fail(new Error(`RPC dialog timed out. ${stderr}`)), dialogDeadlineMs);
    child.stderr.on('data', (data) => {
      stderr += data.toString();
    });
    child.once('error', fail);
    child.stdin.on('error', fail);
    child.once('close', (code) => {
      clearTimeout(timer);
      if (failure || code !== 0) reject(failure ?? new Error(`Pi exited ${code}: ${stderr}`));
      else resolve(outcome);
    });
    readRecords(
      child,
      (value) => {
        if (Check(Select, value)) {
          outcome = { ...outcome, dialogs: [...outcome.dialogs, value] };
          send(child, cancelled ? { type: 'extension_ui_response', id: value.id, cancelled: true } : { type: 'extension_ui_response', id: value.id, value: 'Approve [approve]' });
        }
        if (Check(End, value)) outcome = { ...outcome, results: [...outcome.results, value] };
        if (Check(Event, value) && value.type === 'agent_settled') {
          outcome = { ...outcome, settled: true };
          child.stdin.end();
        }
      },
      fail,
    );
    send(child, { id: 'question', type: 'prompt', message: 'Ask the example approval question.' });
  });
}

async function runDialog(cancelled: boolean): Promise<Outcome> {
  const cli = join(dirname(fileURLToPath(import.meta.resolve('@earendil-works/pi-coding-agent'))), 'bundle/cli.js');
  const directory = await mkdtemp(join(tmpdir(), 'pstack-rpc-dialog-'));
  try {
    const child = spawn(
      process.execPath,
      [
        cli,
        '--mode',
        'rpc',
        '--no-session',
        '--no-extensions',
        '--no-skills',
        '--no-prompt-templates',
        '--no-context-files',
        '-e',
        packageRoot,
        '-e',
        join(packageRoot, 'test/rpc-fixture.ts'),
        '--provider',
        'rpc-test',
        '--model',
        'scripted',
        '--thinking',
        'off',
      ],
      {
        cwd: directory,
        env: { PATH: process.env.PATH, HOME: directory, PI_CODING_AGENT_DIR: directory, PI_OFFLINE: '1' },
        stdio: ['pipe', 'pipe', 'pipe'],
      },
    );
    return await exchange(child, cancelled);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test.each([
  { scenario: 'selected answers', cancelled: false },
  { scenario: 'cancellation', cancelled: true },
])('installed Pi RPC delivers $scenario to AskQuestion', async ({ cancelled }) => {
  const outcome = await runDialog(cancelled);
  expect(outcome.settled).toBe(true);
  expect(outcome.dialogs.length).toBe(1);
  expect(outcome.dialogs[0]?.title).toBe('Approve the example?');
  expect(outcome.dialogs[0]?.options).toEqual(['Approve [approve]', 'Decline [decline]', 'Enter a text answer']);
  expect(outcome.results.length).toBe(1);
  const result = outcome.results[0];
  expect(result).toBeDefined();
  expect(result?.isError).toBe(false);
  const answers = [{ id: 'approval', answers: cancelled ? [] : ['approve'], cancelled }];
  expect(result?.result.details).toEqual(answers);
  expect(result?.result.content[0]?.text).toBe(JSON.stringify(answers));
});
