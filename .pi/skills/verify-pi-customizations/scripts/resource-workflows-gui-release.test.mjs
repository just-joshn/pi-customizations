import assert from 'node:assert/strict';
import test from 'node:test';
import { runGuiReleasedControls } from './probe-resource-workflows-gui-release.mjs';

test('pending controls cannot bypass the parent release', async () => {
  let calls = [];
  await assert.rejects(runGuiReleasedControls({ bridge: { releaseRoot: async () => { throw new Error('held'); }, close: async () => { calls = [...calls, 'rescue']; } }, executeSdk: async () => { calls = [...calls, 'SDK']; } }), /held/);
  assert.deepEqual(calls, ['rescue']);
});

test('pending controls require authentic matching SDK and owner observations', async () => {
  const bridge = { cli: '/protected/client.mjs', releaseRoot: async () => {}, close: async () => {}, snapshot: () => ({ calls: [] }) };
  await assert.rejects(runGuiReleasedControls({ bridge, executeSdk: async () => ({ toolName: 'bash', isError: false, text: 'Hello Ada' }) }), /owner observation/);
});

test('unit fixtures exercise the pending control assertions without producing a positive workflow verdict', async () => {
  const actions = ['launch', 'read', 'click', 'read', 'capture', 'close'];
  const values = ['ready', '', 'Hello Ada', 'Hello Ada', 'Hello Ada', 'closed'];
  let calls = [];
  let rescued = false;
  const bridge = {
    cli: '/protected/client.mjs', releaseRoot: async () => {}, close: async () => { rescued = true; },
    snapshot: () => ({ calls, cleanup: { origin: 'agent', runtime: { vmStopped: true } } }),
  };
  const result = await runGuiReleasedControls({ bridge, executeSdk: async ({ command }) => {
    const index = calls.length;
    const binding = { nonce: 'b'.repeat(64), source: 'c'.repeat(64), boot: '00000000-0000-0000-0000-000000000000', pid: 412, window: 1, host_pid: 123, channel: 'owned-pipe-hvc1:8', sandbox: { sandbox_option: true, fields: { Seccomp: '2', NoNewPrivs: '1', NSpid: '471 4 1', Uid: '1000 1000 1000 1000' } } };
    calls = [...calls, { sequence: index + 1, action: actions[index], observation: { ...binding, seq: index + 1, op: actions[index], value: values[index], sha256: 'a'.repeat(64), decoded: true } }];
    assert.ok(command.endsWith(` ${actions[index]}`));
    return { toolName: 'bash', isError: false };
  } });
  assert.equal(result.verdict, 'FAILED');
  assert.equal(result.invocations.length, 6);
  assert.equal(rescued, true);
});
