import { createHash } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, watch, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';

const hash = (value) => createHash('sha256').update(value).digest('hex');
const within = (path, root) => relative(root, path) !== '..' && !relative(root, path).startsWith('../') && !isAbsolute(relative(root, path));
const protectedName = (path) => /(?:^|\/)(?:auth|models)\.json$/.test(path);

function files(path, root) {
  if (!existsSync(path)) return [];
  const stat = lstatSync(path);
  if (stat.isSymbolicLink() || !within(realpathSync(path), root)) throw new Error(`Unowned Doctor evidence path: ${path}`);
  if (protectedName(path)) throw new Error('Doctor evidence must not include authentication or model files');
  if (stat.isDirectory())
    return readdirSync(path)
      .sort()
      .flatMap((name) => files(join(path, name), root));
  if (!stat.isFile()) throw new Error(`Unsupported Doctor evidence identity: ${path}`);
  return [{ path, sha256: hash(readFileSync(path)), inode: stat.ino, size: stat.size, ctimeMs: stat.ctimeMs, mtimeMs: stat.mtimeMs, mode: stat.mode }];
}

function snapshot(targets, root) {
  return targets.flatMap((path) => (existsSync(path) ? files(path, root) : [{ path, absent: true }]));
}

function changed(before, after) {
  const previous = new Map(before.map((item) => [item.path, JSON.stringify(item)]));
  const current = new Map(after.map((item) => [item.path, JSON.stringify(item)]));
  return [...new Set([...previous.keys(), ...current.keys()])].filter((path) => previous.get(path) !== current.get(path));
}

function toolJournal(records, cwd, targets) {
  const starts = records.flatMap((record, index) => {
    if (record.type !== 'tool_execution_start' || !['write', 'edit', 'bash'].includes(record.toolName)) return [];
    const path = record.args?.path && resolve(cwd, record.args.path);
    if (record.toolName !== 'bash' && !path) return [{ index, toolCallId: record.toolCallId, kind: 'unknown', path: null }];
    if (record.toolName !== 'bash' && !targets.some((target) => within(path, target))) return [{ index, toolCallId: record.toolCallId, kind: 'unscoped', path }];
    return [{ index, toolCallId: record.toolCallId, kind: record.toolName, path: path ?? null, command: record.args?.command ?? null, actor: 'doctor' }];
  });
  return { complete: false, entries: starts.filter((entry) => entry.path), unknownCalls: starts.filter((entry) => !entry.path || entry.kind === 'unscoped').map((entry) => entry.toolCallId), calls: starts };
}

export function doctorAnswers({ records = () => [], onDecision = () => {} } = {}) {
  return new Proxy(
    {},
    {
      get: (_, method) => (request) => {
        const answer = method === 'confirm' ? false : null;
        const response = method === 'confirm' ? { type: 'extension_ui_response', id: request.id, confirmed: false } : { type: 'extension_ui_response', id: request.id, value: null };
        onDecision({ request: structuredClone(request), answer, index: records().length, decision: 'deny-or-cancel', usedDefault: false, expectedResponse: response, deliveryProven: false });
        return answer;
      },
    },
  );
}

function observe(targets, root, records, onEvent, onError) {
  const directories = [...new Set(targets.map((target) => (existsSync(target) && lstatSync(target).isDirectory() ? target : dirname(target))))];
  if (directories.some((directory) => !within(realpathSync(directory), root))) throw new Error('Doctor observer must remain inside its owned root');
  return directories.flatMap((directory) => [false, true].map((recursive) => {
    const watcher = watch(directory, { recursive }, (kind, name) => {
      const path = name === null ? null : join(directory, name.toString());
      if (path === null || targets.some((target) => within(path, target))) onEvent({ path, kind, index: records().length, actor: 'unattributed-notification' });
    });
    watcher.on('error', (error) => onError(error.message));
    return watcher;
  }));
}

function captureStage({ root, cwd, paths, out, initial, previous, records, text, name, events, errors }) {
  const identities = snapshot(paths, root);
  const journal = toolJournal(records, cwd, paths);
  const boundaryChanges = changed(previous, identities).map((path) => ({ path, index: records.length, kind: 'boundary-identity-change', actor: 'doctor' }));
  const payload = {
    name,
    root,
    targets: paths,
    initial,
    identities,
    text,
    reportSha256: hash(text),
    index: records.length - 1,
    records: structuredClone(records),
    journal: { ...journal, events: [...events], boundaryChanges, errors: [...errors] },
  };
  const serialized = JSON.stringify(payload, null, 2);
  const path = join(out, `doctor-${name}-evidence.json`);
  writeFileSync(path, serialized);
  return { ...payload, path, sha256: hash(serialized) };
}

export function createDoctorEvidence({ root, cwd = root, targets, out, records = () => [] }) {
  const ownedRoot = realpathSync(root);
  const paths = targets.map((path) => resolve(path));
  if (!within(realpathSync(cwd), ownedRoot) || paths.length === 0 || paths.some((path) => !within(path, ownedRoot) || protectedName(path))) throw new Error('Doctor targets must be explicitly owned');
  if (within(resolve(out), ownedRoot)) throw new Error('Doctor evidence artifacts must remain outside the writable attempt root');
  mkdirSync(out, { recursive: true });
  let events = [];
  let errors = [];
  let stages = [];
  let pending = new Set();
  let closed = false;
  const initial = snapshot(paths, ownedRoot);
  const watchers = observe(
    paths,
    ownedRoot,
    records,
    (event) => {
      events = [...events, event];
      for (const waiter of pending) if (waiter.path === event.path) waiter.finish(null, event);
    },
    (error) => {
      errors = [...errors, error];
      for (const waiter of pending) waiter.finish(new Error(error));
    },
  );
  return {
    async waitForNotification(path, timeoutMs) {
      if (closed) throw new Error('Doctor observer is closed');
      if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 5000) throw new Error('Doctor notification wait must be bounded at 5 seconds');
      if (!paths.some((target) => within(path, target))) throw new Error('Doctor notification wait requires an owned target');
      if (errors.length) throw new Error(errors.at(-1));
      return new Promise((resolve, reject) => {
        const waiter = {
          path,
          finish(error, event) {
            clearTimeout(timer);
            pending = new Set([...pending].filter((item) => item !== waiter));
            if (error) reject(error);
            else resolve(event);
          },
        };
        const timer = setTimeout(() => waiter.finish(new Error('Doctor notification deadline expired')), timeoutMs);
        pending = new Set([...pending, waiter]);
      });
    },
    checkpoint(name, text = '') {
      if (!['report', 'final'].includes(name) || stages.some((stage) => stage.name === name)) throw new Error('Doctor evidence checkpoints are report and final, each once');
      const stage = captureStage({ root: ownedRoot, cwd, paths, out, initial, previous: stages.at(-1)?.identities ?? initial, records: records(), text, name, events, errors });
      stages = [...stages, stage];
      return stage;
    },
    close() {
      closed = true;
      for (const waiter of pending) waiter.finish(new Error('Doctor observer is closed'));
      for (const watcher of watchers) watcher.close();
    },
  };
}
