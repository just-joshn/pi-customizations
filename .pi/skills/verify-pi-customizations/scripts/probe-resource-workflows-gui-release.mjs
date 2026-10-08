import assert from 'node:assert/strict';

const ACTIONS = Object.freeze(['launch', 'read', 'click', 'read', 'capture', 'close']);
const VALUES = Object.freeze(['ready', '', 'Hello Ada', 'Hello Ada', 'Hello Ada', 'closed']);
const quote = text => `'${text.replaceAll("'", "'\\''")}'`;

function assertGuestBinding(observation, first, sequence, action) {
  assert.equal(observation.seq, sequence);
  assert.equal(observation.op, action);
  for (const key of ['nonce', 'source', 'boot', 'pid', 'window', 'host_pid', 'channel']) assert.equal(observation[key], first[key], `same runtime ${key}`);
  for (const key of ['nonce', 'source']) assert.match(observation[key], /^[a-f0-9]{64}$/);
  assert.match(observation.boot, /^[a-f0-9-]{36}$/);
  assert.match(observation.channel, /^owned-pipe-hvc1:\d+$/);
  for (const key of ['pid', 'window', 'host_pid']) assert.ok(Number.isSafeInteger(observation[key]) && observation[key] > 0);
  if (action === 'launch' || action === 'capture') {
    assert.equal(observation.sandbox.fields.Seccomp, '2');
    assert.equal(observation.sandbox.fields.NoNewPrivs, '1');
    assert.equal(observation.sandbox.sandbox_option, true);
    assert.ok(observation.sandbox.fields.NSpid.split(/\s+/).length > 1);
    assert.deepEqual(observation.sandbox.fields.Uid.split(/\s+/), ['1000', '1000', '1000', '1000']);
  }
}

export async function runGuiReleasedControls({ bridge, audit, openBackend, executeSdk }) {
  let invocations = [];
  try {
    await bridge.releaseRoot({ audit, openBackend });
    for (const [index, action] of ACTIONS.entries()) {
      const command = `${quote(process.execPath)} ${quote(bridge.cli)} ${action}`;
      const sdk = await executeSdk({ command, timeout: 5 });
      const call = bridge.snapshot().calls.at(-1);
      assert.ok(call && call.sequence === index + 1 && call.action === action, 'actual trusted owner observation missing');
      assert.equal(sdk.toolName, 'bash');
      assert.equal(sdk.isError, false);
      assert.equal(call.observation.value, VALUES[index]);
      assertGuestBinding(call.observation, bridge.snapshot().calls[0].observation, index + 1, action);
      if (action === 'capture') {
        assert.match(call.observation.sha256, /^[a-f0-9]{64}$/);
        assert.equal(call.observation.decoded, true);
      }
      invocations = [...invocations, { command, sdk, owner: call }];
    }
    const lease = bridge.snapshot();
    assert.equal(lease.cleanup?.origin, 'agent');
    assert.equal(lease.cleanup?.runtime?.vmStopped, true);
    return { verdict: 'FAILED', scope: 'scripted SDK plumbing only; genuine recipe driver and Root independent audit still required', invocations, lease };
  } finally { await bridge.close(); }
}
