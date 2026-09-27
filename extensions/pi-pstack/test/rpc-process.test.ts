import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import test from 'node:test';
import { rpcProcess } from '../scripts/rpc-process.mjs';

const testRequestDeadlineMs = 2000;
const testShutdownDeadlineMs = 100;

test('RPC extension errors reject pending requests even when the command succeeds', async () => {
  const child = spawn(process.execPath, ['-e', `process.stdin.once('data', () => process.stdout.write(JSON.stringify({type:'extension_error',error:'handler failed'}) + '\\n' + JSON.stringify({type:'response',id:'check-1',success:true,data:{}}) + '\\n'));`]);
  const client = rpcProcess(child, { requestDeadlineMs: testRequestDeadlineMs, shutdownDeadlineMs: testShutdownDeadlineMs });
  try { await assert.rejects(client.send({ type: 'get_state' }), /handler failed/); }
  finally { await client.close(); }
});

for (const lateOutput of ['null\n', 'broken fragment', '{"type":"extension_error","error":"late handler failed"}\n']) {
  test(`RPC finish rejects late failures followed by exit zero ${JSON.stringify(lateOutput)}`, async () => {
    const child = spawn(process.execPath, ['-e', `process.stdin.once('data', () => process.stdout.write(JSON.stringify({type:'response',id:'check-1',success:true,data:{}}) + '\\n')); process.stdin.on('end', () => process.stdout.write(${JSON.stringify(lateOutput)}));`]);
    const client = rpcProcess(child, { requestDeadlineMs: testRequestDeadlineMs, shutdownDeadlineMs: testShutdownDeadlineMs });
    try {
      await client.send({ type: 'get_state' });
      await assert.rejects(client.finish(), /Invalid RPC|handler failed/);
      assert.equal(child.exitCode, 0);
    } finally { await client.close(); }
  });
}

for (const payload of ['null', 'not-json', '[]', '{"type":"response","id":"check-1"}']) {
  test(`RPC rejects malformed record ${payload} and reaps the process`, async () => {
    const child = spawn(process.execPath, ['-e', `process.stdin.once('data', () => process.stdout.write(${JSON.stringify(payload + '\n')}));`]);
    const client = rpcProcess(child, { requestDeadlineMs: testRequestDeadlineMs, shutdownDeadlineMs: testShutdownDeadlineMs });
    try { await assert.rejects(client.send({ type: 'get_state' }), /Invalid RPC/); }
    finally { await client.close(); }
    assert.notEqual(child.exitCode ?? child.signalCode, null);
  });
}

test('RPC stdin failures reject pending and future requests without unhandled errors', async () => {
  const child = spawn(process.execPath, ['-e', 'process.stdin.resume()']);
  const client = rpcProcess(child, { requestDeadlineMs: testRequestDeadlineMs, shutdownDeadlineMs: testShutdownDeadlineMs });
  try {
    const pending = assert.rejects(client.send({ type: 'get_state' }), /broken pipe/);
    child.stdin.destroy(new Error('broken pipe'));
    await pending;
    await assert.rejects(client.send({ type: 'get_state' }), /broken pipe/);
  } finally { await client.close(); }
});

test('RPC startup and timeout errors still allow independent cleanup', async () => {
  const missing = spawn('/missing-pstack-executable');
  const failed = rpcProcess(missing, { requestDeadlineMs: testRequestDeadlineMs, shutdownDeadlineMs: testShutdownDeadlineMs });
  await assert.rejects(failed.send({ type: 'get_state' }), /ENOENT/);
  await failed.close();
  const child = spawn(process.execPath, ['-e', 'process.stdin.resume()']);
  const client = rpcProcess(child, { requestDeadlineMs: testRequestDeadlineMs, shutdownDeadlineMs: testShutdownDeadlineMs });
  try { await assert.rejects(client.send({ type: 'get_state' }), /RPC timed out/); }
  finally { await client.close(); }
  assert.notEqual(child.exitCode ?? child.signalCode, null);
});
