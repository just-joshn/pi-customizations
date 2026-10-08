import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

import { registerDoctorNativeBoundary } from '../helpers/resource-workflows-doctor-native-boundary.mjs';
import { createRpcSession } from '../lib/rpc.mjs';
import { attachDoctorReadonlyChannel } from '../helpers/resource-workflows-doctor-readonly-channel.mjs';
import { createDoctorReadonlyAuthority } from '../helpers/resource-workflows-doctor-readonly.mjs';

test('duplex fd3 client authenticates a correlated request and receives the exact parent receipt', async () => {
  const execution = { code: 0, signal: null, streamsClosed: true, children: [{ pid: 123, code: 0, signal: null, streamsClosed: true }] };
  const a = createDoctorReadonlyAuthority({ deadline: performance.now() + 5000, operations: Object.freeze({ gather: async () => execution, afterVerify: async () => execution }) });
  const transport = attachDoctorReadonlyChannel(a);
  transport.onRecord({ type: 'tool_execution_start', toolName: 'doctor_readonly', toolCallId: 'unit-call', args: { operation: 'gather' } });
  const module = new URL('../helpers/resource-workflows-doctor-readonly-channel.mjs', import.meta.url).href;
  const child = spawn(process.execPath, ['--input-type=module', '-e', `import {createDoctorReadonlyClient} from ${JSON.stringify(module)};const keep=setInterval(()=>{},1000);const c=createDoctorReadonlyClient();const receipt=await c.request('unit-call','gather');process.stdout.write(JSON.stringify(receipt));c.close();clearInterval(keep);`], { stdio: ['ignore', 'pipe', 'pipe', 'pipe'] });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  transport.onChannel(child.stdio[3]);
  try {
    const code = await new Promise((resolve) => child.once('close', resolve));
    assert.equal(code, 0, stderr);
    const receipt = JSON.parse(stdout);
    assert.equal(receipt.origin, 'parent-authenticated-readonly-broker');
    assert.equal(receipt.succeeded, true);
    assert.equal(receipt.complete, false);
    assert.deepEqual(receipt, a.snapshot().calls[0].receipt);
  } finally { child.kill('SIGKILL'); transport.close(); }
});

for (const attack of ['forged-mac', 'unknown-origin', 'extra-request-field', 'malformed-frame', 'oversized-frame']) {
  test(`inherited fd3 rejects ${attack} without launching an operation`, async () => {
    let executions = 0;
    const operation = async () => { executions += 1; throw new Error('must not execute'); };
    const a = createDoctorReadonlyAuthority({ deadline: performance.now() + 600, operations: Object.freeze({ gather: operation, afterVerify: operation }) });
    const transport = attachDoctorReadonlyChannel(a);
    transport.onRecord({ type: 'tool_execution_start', toolName: 'doctor_readonly', toolCallId: 'unit-call', args: { operation: 'gather' } });
    const module = new URL('../helpers/resource-workflows-doctor-readonly.mjs', import.meta.url).href;
    const script = `import {Socket} from 'node:net';import {doctorReadonlyMac} from ${JSON.stringify(module)};
const socket=new Socket({fd:3,readable:true,writable:true});socket.setEncoding('utf8');let buffer='';const keep=setInterval(()=>{},1000);socket.on('error',()=>{});socket.on('close',()=>clearInterval(keep));socket.on('data',chunk=>{buffer+=chunk;let end;while((end=buffer.indexOf('\\n'))>=0){const value=JSON.parse(buffer.slice(0,end));buffer=buffer.slice(end+1);if(value.type==='doctor_readonly_hello'){const attack=${JSON.stringify(attack)};if(attack==='malformed-frame'){socket.write('{malformed\\n');continue;}if(attack==='oversized-frame'){socket.write('x'.repeat(70000));continue;}const request={type:'doctor_readonly',toolCallId:attack==='unknown-origin'?'unobserved':'unit-call',operation:'gather',nonce:'b'.repeat(64)};const envelope={...request,mac:doctorReadonlyMac(value.key,request)};if(attack==='forged-mac')envelope.mac='0'.repeat(64);if(attack==='extra-request-field')envelope.argv=['/bin/sh'];socket.write(JSON.stringify(envelope)+'\\n');}else{process.stdout.write(JSON.stringify(value));socket.destroy();}}});`;
    const child = spawn(process.execPath, ['--input-type=module', '-e', script], { stdio: ['ignore', 'pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    transport.onChannel(child.stdio[3]);
    const rescue = setTimeout(() => child.kill('SIGKILL'), 5000);
    try {
      const code = await new Promise((resolve) => child.once('close', resolve));
      assert.equal(code, 0, stderr);
      assert.equal(executions, 0);
      if (!['malformed-frame', 'oversized-frame'].includes(attack)) assert.match(JSON.parse(stdout).error, /authentication|observed|request/);
      assert.equal(a.snapshot().complete, false);
    } finally { clearTimeout(rescue); child.kill('SIGKILL'); transport.close(); }
  });
}

const pi = realpathSync(execFileSync('/bin/sh', ['-c', 'command -v pi'], { encoding: 'utf8' }).trim());
const sdk = pathToFileURL(join(pi, '../../install/releases/1.1.0/node_modules/@earendil-works/pi-coding-agent/dist/index.js')).href;

test('native tool boundary allows only exact authenticated broker in addition to native tools', async () => {
  const tools = new Map();
  let hook;
  const client = { request: async (id, operation) => ({ origin: 'parent', toolCallId: id, operation }) };
  await registerDoctorNativeBoundary({ registerTool: (tool) => tools.set(tool.name, tool), on: (_, callback) => { hook = callback; } }, { cwd: '/tmp', phase: 'report', groups: [], readonly: client }, sdk);
  assert.equal(hook({ toolName: 'doctor_readonly' }), undefined);
  assert.equal(hook({ toolName: 'bash' }).block, true);
  assert.equal(hook({ toolName: 'doctor_readonly_extra' }).block, true);
  assert.equal(hook({ toolName: 'write' }).block, true);
  const tool = tools.get('doctor_readonly');
  assert.ok(tool);
  const result = await tool.execute('real-id', { operation: 'gather' });
  assert.deepEqual(result.details.doctorReadonly, { origin: 'parent', toolCallId: 'real-id', operation: 'gather' });
  await assert.rejects(tool.execute('bad', { operation: 'gather', path: '/etc/passwd' }), /operation/);
});

test('RPC exposes inherited fd3 and synchronous record observation without changing default arguments', async (t) => {
  const root = mkdtempSync('/tmp/doctor-rpc-channel-');
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const executable = join(root, 'rpc');
  const agentDir = join(root, 'agent');
  mkdirSync(agentDir);
  writeFileSync(executable, `#!/usr/bin/env node
const fs = require('node:fs');
fs.writeSync(3, 'child-channel\\n');
process.stdout.write(JSON.stringify({type:'witness', argv:process.argv.slice(2)})+'\\n');
const rl = require('node:readline').createInterface({input:process.stdin});
rl.on('line', line=>{const c=JSON.parse(line); process.stdout.write(JSON.stringify({type:'response', id:c.id, command:c.type, success:true, data:c.type==='get_state'?{isStreaming:false,isCompacting:false,pendingMessageCount:0}:null})+'\\n');});
rl.on('close',()=>process.exit(0));
`, { mode: 0o700 });
  let channelText = '';
  let witness;
  const session = createRpcSession({ piBin: executable, packagePath: '/fixed-extension', agentDir, onChannel: (channel) => { channel.setEncoding('utf8'); channel.on('data', (text) => { channelText += text; }); }, onRecord: (record) => { if (record.type === 'witness') witness = record; } });
  t.after(() => session.close());
  await session.waitFor((record) => record.type === 'witness');
  await session.close();
  assert.equal(channelText, 'child-channel\n');
  assert.deepEqual(witness.argv, ['--mode', 'rpc', '--no-extensions', '-e', '/fixed-extension', '--no-session']);
  assert.equal(session.pid, null);
});
