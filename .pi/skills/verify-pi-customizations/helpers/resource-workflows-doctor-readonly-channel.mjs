import { randomBytes } from 'node:crypto';
import { Socket } from 'node:net';

import { doctorReadonlyMac, validateDoctorReadonlyInput } from './resource-workflows-doctor-readonly.mjs';

export function attachDoctorReadonlyChannel(authority) {
  let channel = null;
  let buffer = '';
  let queued = null;
  let running = false;
  let closed = false;
  const reply = (value) => { if (channel && !channel.destroyed) channel.write(`${JSON.stringify(value)}\n`); };
  async function pump() {
    if (!queued || running || closed) return;
    if (!authority.snapshot().calls.some((call) => call.toolCallId === queued.toolCallId)) return;
    const request = queued;
    queued = null;
    running = true;
    try { reply({ type: 'doctor_readonly_result', toolCallId: request.toolCallId, receipt: await authority.request(request) }); }
    catch (error) { reply({ type: 'doctor_readonly_result', toolCallId: request.toolCallId, error: error.message }); }
    finally { running = false; }
  }
  const timer = setTimeout(() => {
    closed = true;
    if (queued) reply({ type: 'doctor_readonly_result', toolCallId: queued.toolCallId, error: 'Doctor total prompt deadline expired without observed start' });
    queued = null;
  }, Math.max(1, authority.snapshot().deadline - performance.now()));
  timer.unref();
  return Object.freeze({
    onRecord(record) { authority.observe(record); void pump(); },
    onChannel(stream) {
      if (channel) throw new Error('Doctor readonly channel cannot be replaced');
      channel = stream;
      channel.setEncoding('utf8');
      channel.on('error', () => { closed = true; });
      channel.on('close', () => { closed = true; clearTimeout(timer); });
      channel.on('data', (chunk) => {
        buffer += chunk;
        if (buffer.length > 65536) { closed = true; channel.destroy(); return; }
        let boundary;
        while ((boundary = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 1);
          let value;
          try { value = JSON.parse(line); } catch { closed = true; channel.destroy(); return; }
          if (closed || queued || running) { reply({ type: 'doctor_readonly_result', toolCallId: value.toolCallId, error: 'Doctor readonly channel is closed or occupied' }); continue; }
          queued = value;
          void pump();
        }
      });
      reply({ type: 'doctor_readonly_hello', key: authority.key });
    },
    close() { closed = true; clearTimeout(timer); channel?.destroy(); },
  });
}

export function createDoctorReadonlyClient(fd = 3) {
  const channel = new Socket({ fd, readable: true, writable: true });
  let buffer = '';
  let key = null;
  let pending = new Map();
  let readyResolve;
  let readyReject;
  const ready = new Promise((resolve, reject) => { readyResolve = resolve; readyReject = reject; });
  ready.catch(() => {});
  const fail = (error) => {
    readyReject(error);
    for (const entry of pending.values()) entry.reject(error);
    pending = new Map();
  };
  channel.setEncoding('utf8');
  channel.on('error', fail);
  channel.on('close', () => fail(new Error('Doctor readonly authenticated channel closed')));
  channel.on('data', (chunk) => {
    buffer += chunk;
    if (buffer.length > 8388608) { fail(new Error('Doctor readonly receipt limit exceeded')); channel.destroy(); return; }
    let boundary;
    while ((boundary = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 1);
      let value;
      try { value = JSON.parse(line); } catch { fail(new Error('Doctor readonly invalid channel response')); channel.destroy(); return; }
      if (value.type === 'doctor_readonly_hello' && key === null && /^[a-f0-9]{64}$/.test(value.key)) { key = value.key; readyResolve(); continue; }
      const entry = pending.get(value.toolCallId);
      if (value.type !== 'doctor_readonly_result' || !entry) { fail(new Error('Doctor readonly unexpected or duplicate parent response')); channel.destroy(); return; }
      pending = new Map([...pending].filter(([id]) => id !== value.toolCallId));
      if (value.error) entry.reject(new Error(value.error));
      else entry.resolve(value.receipt);
    }
  });
  channel.unref();
  return Object.freeze({
    async request(toolCallId, operation) {
      validateDoctorReadonlyInput({ operation });
      await ready;
      if (pending.size || channel.destroyed) throw new Error('Doctor readonly client is occupied or closed');
      const value = { type: 'doctor_readonly', toolCallId, operation, nonce: randomBytes(32).toString('hex') };
      return new Promise((resolve, reject) => {
        pending = new Map([[toolCallId, { resolve, reject }]]);
        channel.write(`${JSON.stringify({ ...value, mac: doctorReadonlyMac(key, value) })}\n`, (error) => { if (error) fail(error); });
      });
    },
    close: () => channel.destroy(),
  });
}
