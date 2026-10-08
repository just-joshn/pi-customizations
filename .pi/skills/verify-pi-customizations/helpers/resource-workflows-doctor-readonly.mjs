import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';

export const doctorReadonlyOperations = Object.freeze(['gather', 'afterVerify']);
export const readonlyDigest = (value) => createHash('sha256').update(value).digest('hex');
const freeze = (value) => {
  for (const item of Object.values(value)) if (item && typeof item === 'object') freeze(item);
  return Object.freeze(value);
};

export function validateDoctorReadonlyInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).length !== 1 || !doctorReadonlyOperations.includes(input.operation))
    throw new Error('Doctor readonly requires only a fixed operation');
  return Object.freeze({ operation: input.operation });
}

export function doctorReadonlyMac(key, request) {
  return createHmac('sha256', key).update(JSON.stringify([request.type, request.toolCallId, request.operation, request.nonce])).digest('hex');
}

export function createDoctorReadonlyAuthority({ operations, deadline, key = randomBytes(32).toString('hex'), publish = (receipt) => receipt }) {
  if (!Number.isFinite(deadline) || deadline - performance.now() > 120000 || !/^[a-f0-9]{64}$/.test(key)) throw new Error('Doctor broker requires a bounded total deadline and authentication key');
  if (Object.keys(operations).sort().join(',') !== 'afterVerify,gather' || !doctorReadonlyOperations.every((name) => typeof operations[name] === 'function') || !Object.isFrozen(operations))
    throw new Error('Doctor broker requires the immutable fixed operation registry');
  let calls = new Map();
  let nonces = new Set();
  let violations = [];
  const violation = (reason, id) => { violations = [...violations, { reason, toolCallId: id }]; };
  const replace = (id, value) => { calls = new Map([...calls, [id, freeze(value)]]); };

  function observe(record) {
    if (record.type === 'tool_execution_start' && record.toolName === 'doctor_readonly') {
      const id = record.toolCallId;
      if (typeof id !== 'string' || !id || calls.has(id)) {
        violation('duplicate or invalid observed start', id);
        if (calls.has(id)) replace(id, { ...calls.get(id), status: 'invalid' });
        return;
      }
      try {
        const { operation } = validateDoctorReadonlyInput(record.args);
        replace(id, { toolCallId: id, operation, status: 'observed', correlated: false, receipt: null });
      } catch (error) {
        violation(error.message, id);
        replace(id, { toolCallId: id, status: 'invalid', correlated: false, receipt: null });
      }
    }
    if (record.type !== 'tool_execution_end' || !calls.has(record.toolCallId)) return;
    const call = calls.get(record.toolCallId);
    const evidence = record.result?.details?.doctorReadonly;
    const correlated = call.status === 'completed' && evidence && readonlyDigest(JSON.stringify(evidence)) === readonlyDigest(JSON.stringify(call.receipt));
    if (!correlated) violation('tool end lacks exact protected parent receipt or arrived before completion', record.toolCallId);
    replace(record.toolCallId, { ...call, status: correlated ? 'ended' : 'invalid', correlated: Boolean(correlated) });
  }

  async function request(value) {
    if (!value || Object.keys(value).sort().join(',') !== 'mac,nonce,operation,toolCallId,type' || value.type !== 'doctor_readonly' || typeof value.toolCallId !== 'string' || !/^[a-f0-9]{64}$/.test(value.nonce) || !/^[a-f0-9]{64}$/.test(value.mac))
      throw new Error('Invalid Doctor broker request');
    if (!timingSafeEqual(Buffer.from(value.mac, 'hex'), Buffer.from(doctorReadonlyMac(key, value), 'hex'))) throw new Error('Doctor broker authentication failed');
    if (nonces.has(value.nonce)) throw new Error('Doctor broker rejects nonce replay');
    const call = calls.get(value.toolCallId);
    if (!call || call.status !== 'observed' || call.operation !== value.operation) throw new Error('Doctor broker requires one unconsumed parent observed SDK start');
    if (performance.now() >= deadline) throw new Error('Doctor total prompt deadline expired');
    nonces = new Set([...nonces, value.nonce]);
    replace(value.toolCallId, { ...call, status: 'running' });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.max(1, deadline - performance.now()));
    let execution;
    let error = null;
    try {
      execution = await operations[value.operation]({ signal: controller.signal, deadline, toolCallId: value.toolCallId });
    } catch (failure) {
      error = failure.message;
      execution = null;
    } finally {
      clearTimeout(timer);
    }
    const rescued = controller.signal.aborted || execution?.rescued === true;
    const children = execution?.children ?? [];
    const succeeded = !error && !rescued && !execution?.evidenceError && execution?.code === 0 && execution.signal === null && execution.streamsClosed === true && children.length > 0 && children.every((child) => Number.isInteger(child.pid) && child.code === 0 && child.signal === null && child.streamsClosed === true);
    const receipt = freeze({
      receiptId: randomUUID(), origin: 'parent-authenticated-readonly-broker', toolCallId: value.toolCallId, operation: value.operation,
      agentInitiated: true, synchronousCompletion: true, succeeded: Boolean(succeeded), complete: false, rescued, error,
      limitation: 'Direct-child exits do not prove all descendant exits. An independent confined descendant ownership observer is unavailable.',
      execution: execution ? structuredClone(execution) : null,
    });
    const protectedReceipt = freeze(await publish(receipt));
    replace(value.toolCallId, { ...calls.get(value.toolCallId), status: 'completed', receipt: protectedReceipt });
    return protectedReceipt;
  }

  return Object.freeze({
    key, observe, request,
    snapshot: () => freeze({ calls: [...calls.values()].map((call) => structuredClone(call)), violations: structuredClone(violations), complete: false, deadline }),
  });
}
