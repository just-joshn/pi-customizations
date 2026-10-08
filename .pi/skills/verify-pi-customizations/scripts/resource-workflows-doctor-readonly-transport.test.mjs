import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

import { registerDoctorNativeBoundary } from '../helpers/resource-workflows-doctor-native-boundary.mjs';
import { createRpcSession } from '../lib/rpc.mjs';

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
