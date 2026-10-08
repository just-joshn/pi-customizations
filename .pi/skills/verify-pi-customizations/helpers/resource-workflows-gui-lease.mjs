import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import { join, resolve } from 'node:path';

export const GUI_ACTIONS = Object.freeze(['launch', 'read', 'input', 'click', 'capture', 'close']);
const APPLICATION_FILES = Object.freeze({ electron: Object.freeze(['index.html', 'main.cjs', 'package.json']), playwright: Object.freeze(['package.json', 'server.mjs']) });
export const guiDigest = bytes => createHash('sha256').update(bytes).digest('hex');

export function applicationManifest(kind, cwd) {
  const names = APPLICATION_FILES[kind];
  if (!names) throw new Error('unsupported GUI kind');
  const directory = realpathSync(cwd);
  return Object.freeze(Object.fromEntries(names.map(name => {
    const path = join(directory, name);
    const stat = lstatSync(path);
    if (!stat.isFile() || stat.nlink !== 1 || realpathSync(path) !== resolve(path)) throw new Error('application must be a regular private file');
    return [name, guiDigest(readFileSync(path))];
  })));
}

export function assertApplication(kind, cwd, expected) {
  if (JSON.stringify(applicationManifest(kind, cwd)) !== JSON.stringify(expected)) throw new Error('application identity changed');
}

export function parseGuiRequest(request) {
  if (!request || Object.getPrototypeOf(request) !== Object.prototype || Object.keys(request).sort().join() !== 'action,capability' ||
      typeof request.capability !== 'string' || !/^[a-f0-9]{64}$/.test(request.capability) || !GUI_ACTIONS.includes(request.action)) throw new Error('invalid GUI request');
  return Object.freeze({ capability: request.capability, action: request.action });
}

async function teardownBudget(work) {
  let timer;
  const deadline = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('GUI teardown deadline')), 5000); });
  try { return await Promise.race([work, deadline]); }
  finally { clearTimeout(timer); }
}

function closeLease(lease, origin) {
  if (lease.get().closePromise) return lease.get().closePromise;
  clearTimeout(lease.get().timer);
  const work = Promise.resolve().then(async () => {
    await lease.get().releasePromise?.catch(() => {});
    const backend = lease.get().backend;
    const cleanup = Object.freeze({ origin, runtime: backend ? await backend.close() : null });
    if (!lease.get().cleanup?.error) lease.update({ cleanup });
    return cleanup;
  });
  const closePromise = teardownBudget(work).catch(error => {
    lease.update({ cleanup: Object.freeze({ origin, error: error.message }) });
    throw error;
  });
  lease.update({ phase: 'closed', closePromise });
  lease.controller.abort();
  return closePromise;
}

async function releaseLease(lease, { audit, openBackend } = {}) {
  if (lease.get().phase !== 'held' || lease.get().busy || typeof audit !== 'function' || typeof openBackend !== 'function') throw new Error('invalid parent release');
  assertApplication(lease.kind, lease.cwd, lease.application);
  const releasePromise = (async () => {
    const reviewed = await audit(Object.freeze({ kind: lease.kind, application: lease.application }), lease.controller.signal);
    if (lease.get().phase === 'closed') throw new Error('GUI lease closed');
    if (JSON.stringify(reviewed?.application) !== JSON.stringify(lease.application)) throw new Error('independent audit application binding missing');
    assertApplication(lease.kind, lease.cwd, lease.application);
    const backend = await openBackend(reviewed, lease.controller.signal);
    if (typeof backend?.action !== 'function' || typeof backend?.close !== 'function') throw new Error('invalid trusted backend');
    if (lease.get().phase === 'closed') { await backend.close(); throw new Error('GUI lease closed'); }
    const timer = setTimeout(() => { closeLease(lease, 'parent').catch(error => lease.update({ cleanup: { origin: 'parent', error: error.message } })); }, 100000);
    timer.unref?.();
    lease.update({ backend, phase: 'ready', deadline: lease.clock() + 100000, timer });
  })();
  lease.update({ busy: true, releasePromise });
  try { await releasePromise; }
  finally { lease.update({ busy: false }); }
}

async function runAction(lease, backend, action) {
  let aborted;
  const cancellation = new Promise((_, reject) => {
    aborted = () => reject(new Error('GUI lease closed'));
    lease.controller.signal.addEventListener('abort', aborted, { once: true });
  });
  try { return await Promise.race([backend.action(action, lease.controller.signal), cancellation]); }
  finally { lease.controller.signal.removeEventListener('abort', aborted); }
}

async function dispatchLease(lease, raw) {
  const request = parseGuiRequest(raw);
  if (!timingSafeEqual(Buffer.from(request.capability), Buffer.from(lease.capability))) throw new Error('GUI capability rejected');
  const state = lease.get();
  if (state.phase === 'held') throw new Error('runtime release held');
  if (request.action === 'close' && state.cleanup?.origin === 'agent') return state.cleanup;
  if (state.phase === 'closed') throw new Error('GUI lease closed');
  if (lease.clock() >= state.deadline) { await closeLease(lease, 'parent'); throw new Error('GUI lease expired'); }
  if (state.calls.length >= 12 || (request.action === 'capture' && state.calls.some(call => call.action === 'capture'))) throw new Error('GUI request limit');
  if (state.busy || !((state.phase === 'ready' && request.action === 'launch') || (state.phase === 'open' && request.action !== 'launch'))) throw new Error('invalid GUI state');
  assertApplication(lease.kind, lease.cwd, lease.application);
  lease.update({ busy: true });
  try {
    const observation = await runAction(lease, state.backend, request.action);
    if (lease.get().phase === 'closed') throw new Error('GUI lease closed');
    const call = Object.freeze({ action: request.action, sequence: state.calls.length + 1, observation });
    lease.update({ phase: 'open', calls: [...state.calls, call] });
    return request.action === 'close' ? await closeLease(lease, 'agent') : observation;
  } catch (error) {
    await closeLease(lease, 'parent');
    throw error;
  } finally { lease.update({ busy: false }); }
}

export function createGuiLease({ kind, cwd, clock = () => performance.now() }) {
  const application = applicationManifest(kind, cwd);
  const capability = randomBytes(32).toString('hex');
  let state = Object.freeze({ phase: 'held', backend: null, calls: [], cleanup: null, busy: false, deadline: null, timer: null, releasePromise: null, closePromise: null });
  const lease = Object.freeze({ kind, cwd, application, capability, clock, controller: new AbortController(), get: () => state, update: change => { state = Object.freeze({ ...state, ...change }); } });
  const snapshot = () => structuredClone({ state: state.phase, calls: state.calls, cleanup: state.cleanup, verdict: 'FAILED' });
  return Object.freeze({ capability, application, snapshot, dispatch: raw => dispatchLease(lease, raw), release: options => releaseLease(lease, options), close: () => closeLease(lease, 'parent') });
}
