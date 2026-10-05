import { spawn } from 'node:child_process';
import { once } from 'node:events';

import { expect, test } from 'vitest';
import { rpcProcess } from '../scripts/rpc-process.mjs';

const testRequestDeadlineMs = 2000;
const testShutdownDeadlineMs = 2000;

test('RPC extension errors reject pending requests even when the command succeeds', async () => {
  const child = spawn(process.execPath, [
    '-e',
    `process.stdin.once('data', () => process.stdout.write(JSON.stringify({type:'extension_error',error:'handler failed'}) + '\\n' + JSON.stringify({type:'response',id:'check-1',success:true,data:{}}) + '\\n'));`,
  ]);
  const client = rpcProcess(child, { requestDeadlineMs: testRequestDeadlineMs, shutdownDeadlineMs: testShutdownDeadlineMs });
  try {
    await expect(client.send({ type: 'get_state' })).rejects.toThrow(/handler failed/);
  } finally {
    await client.close();
  }
});

test.each(['null\n', 'broken fragment', '{"type":"extension_error","error":"late handler failed"}\n'])('RPC finish rejects late failures followed by exit zero %j', async (lateOutput) => {
  const child = spawn(process.execPath, [
    '-e',
    `process.stdin.once('data', () => process.stdout.write(JSON.stringify({type:'response',id:'check-1',success:true,data:{}}) + '\\n')); process.stdin.on('end', () => process.stdout.write(${JSON.stringify(lateOutput)}));`,
  ]);
  const client = rpcProcess(child, { requestDeadlineMs: testRequestDeadlineMs, shutdownDeadlineMs: testShutdownDeadlineMs });
  try {
    await client.send({ type: 'get_state' });
    await expect(client.finish()).rejects.toThrow(/Invalid RPC|handler failed/);
    expect(child.exitCode).toBe(0);
  } finally {
    await client.close();
  }
});

test.each(['null', 'not-json', '[]', '{"type":"response","id":"check-1"}'])('RPC rejects malformed record %s', async (payload) => {
  const child = spawn(process.execPath, ['-e', `process.stdin.once('data', () => process.stdout.write(${JSON.stringify(`${payload}\n`)}));`]);
  const client = rpcProcess(child, { requestDeadlineMs: testRequestDeadlineMs, shutdownDeadlineMs: testShutdownDeadlineMs });
  try {
    await expect(client.send({ type: 'get_state' })).rejects.toThrow(/Invalid RPC/);
  } finally {
    await client.close();
  }
  expect(child.exitCode ?? child.signalCode).not.toBeNull();
});

test('RPC stdin failures reject pending and future requests without unhandled errors', async () => {
  const child = spawn(process.execPath, ['-e', 'process.stdin.resume()']);
  const client = rpcProcess(child, { requestDeadlineMs: testRequestDeadlineMs, shutdownDeadlineMs: testShutdownDeadlineMs });
  try {
    const pending = expect(client.send({ type: 'get_state' })).rejects.toThrow(/broken pipe/);
    child.stdin.destroy(new Error('broken pipe'));
    await pending;
    await expect(client.send({ type: 'get_state' })).rejects.toThrow(/broken pipe/);
  } finally {
    await client.close();
  }
});

test('RPC startup failure rejects the request', async () => {
  const missing = spawn('/missing-pstack-executable');
  const client = rpcProcess(missing, { requestDeadlineMs: testRequestDeadlineMs, shutdownDeadlineMs: testShutdownDeadlineMs });
  try {
    await expect(client.send({ type: 'get_state' })).rejects.toThrow(/ENOENT/);
  } finally {
    await client.close();
  }
});

test('RPC request timeout rejects the request and reaps the process', async () => {
  const child = spawn(process.execPath, ['-e', 'process.stdin.resume()']);
  const client = rpcProcess(child, { requestDeadlineMs: testRequestDeadlineMs, shutdownDeadlineMs: testShutdownDeadlineMs });
  try {
    await expect(client.send({ type: 'get_state' })).rejects.toThrow(/RPC timed out/);
  } finally {
    await client.close();
  }
  expect(child.exitCode ?? child.signalCode).not.toBeNull();
});

test('RPC reports the exit reason of a child that closed its input', async () => {
  const child = spawn('/bin/sh', ['-c', 'exec 0<&-; printf "sandbox refused" >&2; sleep 0.3; exit 3']);
  const client = rpcProcess(child, { requestDeadlineMs: testRequestDeadlineMs, shutdownDeadlineMs: testShutdownDeadlineMs });
  try {
    await once(child.stderr, 'data');
    await expect(client.send({ type: 'get_state' })).rejects.toThrow('Pi exited 3: sandbox refused');
  } finally {
    await client.close();
  }
});
