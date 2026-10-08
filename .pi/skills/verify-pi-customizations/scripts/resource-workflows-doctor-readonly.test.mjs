import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

import { createDoctorReadonlyAuthority, doctorReadonlyMac, validateDoctorReadonlyInput } from '../helpers/resource-workflows-doctor-readonly.mjs';
import { validateDoctorLoaderEvidence } from '../helpers/resource-workflows-doctor-readonly-loader.mjs';

const key = 'a'.repeat(64);
const start = (id = 'call', operation = 'gather') => ({ type: 'tool_execution_start', toolCallId: id, toolName: 'doctor_readonly', args: { operation } });
const request = (id = 'call', operation = 'gather', nonce = 'b'.repeat(64)) => {
  const value = { type: 'doctor_readonly', toolCallId: id, operation, nonce };
  return { ...value, mac: doctorReadonlyMac(key, value) };
};
const result = { code: 0, signal: null, streamsClosed: true, children: [{ pid: 12, code: 0, signal: null, streamsClosed: true }], descendantProof: null };
const authority = (execute = async () => result, deadline = performance.now() + 1000) => createDoctorReadonlyAuthority({ key, deadline, operations: Object.freeze({ gather: execute, afterVerify: execute }) });

for (const input of [null, {}, { operation: 'bash' }, { operation: 'gather', path: '/tmp' }, { operation: 'afterVerify', argv: [] }, { operation: 'gather', env: {} }]) {
  test(`readonly tool rejects additional or invalid inputs ${JSON.stringify(input)}`, () => assert.throws(() => validateDoctorReadonlyInput(input), /operation/));
}
test('readonly tool admits only fixed operation names', () => {
  assert.deepEqual(validateDoctorReadonlyInput({ operation: 'gather' }), { operation: 'gather' });
  assert.deepEqual(validateDoctorReadonlyInput({ operation: 'afterVerify' }), { operation: 'afterVerify' });
});
test('MAC binds every request field', () => {
  const value = request();
  assert.equal(value.mac, createHmac('sha256', key).update(JSON.stringify(['doctor_readonly', 'call', 'gather', 'b'.repeat(64)])).digest('hex'));
});
test('authenticated observed SDK call completes with a parent receipt, not descendant self-attestation', async () => {
  const a = authority();
  a.observe(start());
  const receipt = await a.request(request());
  assert.equal(receipt.toolCallId, 'call');
  assert.equal(receipt.operation, 'gather');
  assert.equal(receipt.origin, 'parent-authenticated-readonly-broker');
  assert.equal(receipt.agentInitiated, true);
  assert.equal(receipt.synchronousCompletion, true);
  assert.equal(receipt.complete, false);
  assert.match(receipt.limitation, /descendant/);
  a.observe({ type: 'tool_execution_end', toolCallId: 'call', isError: false, result: { details: { doctorReadonly: receipt } } });
  assert.equal(a.snapshot().calls[0].correlated, true);
});
test('forged MAC and unobserved origin never execute', async () => {
  let executions = 0;
  const a = authority(async () => { executions += 1; return result; });
  a.observe(start());
  await assert.rejects(a.request({ ...request(), mac: '0'.repeat(64) }), /authentication/);
  await assert.rejects(a.request(request('unseen')), /observed/);
  assert.equal(executions, 0);
});
test('duplicate requests and replay across tool IDs never execute twice', async () => {
  let executions = 0;
  const a = authority(async () => { executions += 1; return result; });
  a.observe(start());
  await a.request(request());
  await assert.rejects(a.request(request()), /consumed|replay/);
  a.observe(start('next'));
  await assert.rejects(a.request(request('next')), /replay/);
  assert.equal(executions, 1);
});
test('operation substitution and arbitrary request fields are rejected', async () => {
  const a = authority();
  a.observe(start());
  await assert.rejects(a.request(request('call', 'afterVerify')), /observed/);
  await assert.rejects(a.request({ ...request(), argv: ['sh'] }), /request/);
});
test('duplicate starts and a tool end before request invalidate authority', async () => {
  const duplicate = authority();
  duplicate.observe(start());
  duplicate.observe(start());
  await assert.rejects(duplicate.request(request()), /observed/);
  const gap = authority();
  gap.observe(start());
  gap.observe({ type: 'tool_execution_end', toolCallId: 'call', isError: false });
  await assert.rejects(gap.request(request()), /observed/);
});
test('forged receipt at tool end is a correlation violation', async () => {
  const a = authority();
  a.observe(start());
  const receipt = await a.request(request());
  a.observe({ type: 'tool_execution_end', toolCallId: 'call', isError: false, result: { details: { doctorReadonly: { ...receipt, receiptId: 'forged' } } } });
  assert.equal(a.snapshot().calls[0].correlated, false);
  assert.equal(a.snapshot().violations.length, 1);
});
test('child failure and open streams never prove successful completion', async () => {
  for (const execution of [{ ...result, code: 1 }, { ...result, streamsClosed: false }, { ...result, children: [] }]) {
    const a = authority(async () => execution);
    a.observe(start());
    const receipt = await a.request(request());
    assert.equal(receipt.succeeded, false);
    assert.equal(receipt.complete, false);
  }
});
test('expired total deadline rejects before launching an operation', async () => {
  const a = authority(async () => { assert.fail('must not launch'); }, performance.now() - 1);
  a.observe(start());
  await assert.rejects(a.request(request()), /deadline/);
});
test('aborted operation waits for actual execution cleanup and records rescue incomplete', async () => {
  const a = authority(async ({ signal }) => {
    await new Promise((resolve) => signal.addEventListener('abort', () => setTimeout(resolve, 10), { once: true }));
    return { ...result, code: null, signal: 'SIGKILL', rescued: true };
  }, performance.now() + 20);
  a.observe(start());
  const receipt = await a.request(request());
  assert.equal(receipt.rescued, true);
  assert.equal(receipt.complete, false);
  assert.equal(receipt.succeeded, false);
});
test('an execution exception produces a protected failure receipt', async () => {
  const a = authority(async () => { throw new Error('child failed'); });
  a.observe(start());
  const receipt = await a.request(request());
  assert.equal(receipt.succeeded, false);
  assert.match(receipt.error, /child failed/);
});
test('end gap remains incomplete and no operation can assert an empty child domain', async () => {
  const a = authority(async () => ({ ...result, children: [], descendantProof: { complete: true } }));
  a.observe(start());
  const receipt = await a.request(request());
  assert.equal(receipt.complete, false);
  assert.equal(a.snapshot().calls[0].correlated, false);
});
test('loader validation binds actual session, target settings, image, and inventory bytes', (t) => {
  const root = mkdtempSync('/tmp/doctor-loader-test-');
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const settings = join(root, 'settings.json');
  const image = join(root, 'pi');
  const session = join(root, 'session.jsonl');
  writeFileSync(settings, '{}');
  writeFileSync(image, 'actual-image');
  writeFileSync(session, '{"type":"session","id":"fresh"}\n');
  const facts = { agentDir: root, cwd: root, settings, image, session, sessionDir: root, inventory: { settings: { user: 'ok' }, prompt: { loaded_skills: [{ name: 'enabled', location: '/enabled/SKILL.md' }], tool_chars: { read: 10 } } } };
  const sealed = validateDoctorLoaderEvidence(facts);
  assert.equal(sealed.sourceBound, true);
  assert.deepEqual(sealed.loadedSkills, facts.inventory.prompt.loaded_skills);
  assert.deepEqual(sealed.toolDeclarations, { read: 10 });
  for (const wrong of [{ ...sealed, agentDir: '/wrong' }, { ...sealed, imageSha256: '0'.repeat(64) }, { ...sealed, settingsSha256: '0'.repeat(64) }, { ...sealed, sessionSha256: '0'.repeat(64) }]) {
    assert.throws(() => validateDoctorLoaderEvidence(facts, wrong), /source|target|loader|settings|session/);
  }
  writeFileSync(settings, '{"skills":[]}');
  assert.throws(() => validateDoctorLoaderEvidence(facts, sealed), /settings/);
  assert.notEqual(readFileSync(settings, 'utf8'), '{}');
});
