import { createHash, randomUUID } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';

import { createRpcSession } from '../lib/rpc.mjs';
import { prepareDoctorGuard } from './resource-workflows-doctor-lease-guard.mjs';

export const doctorDigest = (value) => createHash('sha256').update(value).digest('hex');
const inside = (path, root) => path === root || (!isAbsolute(relative(root, path)) && !relative(root, path).startsWith('..'));
const quote = (value) => `'${value.replaceAll("'", "'\\''")}'`;
const freeze = (value) => {
  for (const item of Object.values(value)) if (item && typeof item === 'object') freeze(item);
  return Object.freeze(value);
};

function canonical(path, root, regular = false) {
  if (!isAbsolute(path) || resolve(path) !== path || !inside(path, root)) throw new Error(`Unowned Doctor lease path: ${path}`);
  let current = path;
  while (inside(current, root)) {
    if (existsSync(current) && (lstatSync(current).isSymbolicLink() || realpathSync(current) !== current)) throw new Error(`Doctor lease rejects symlinks: ${path}`);
    if (current === root) break;
    current = dirname(current);
  }
  if (regular && (!existsSync(path) || !lstatSync(path).isFile() || lstatSync(path).nlink !== 1)) throw new Error('Doctor mutation leases require existing singly-linked regular files');
  return path;
}

export function doctorApprovedPaths(groups, targets, root) {
  return groups.flatMap((group) => {
    if (group.effect !== 'edit' || !group.id || !Array.isArray(group.paths) || group.paths.length === 0) throw new Error('Doctor mutation leases support explicit existing-file edit groups only');
    return group.paths.map((path) => {
      canonical(path, root, true);
      if (!targets.some((target) => inside(path, target))) throw new Error('Doctor approved path is outside its protected targets');
      return path;
    });
  });
}

export function doctorLeasePolicy({ doctor, root, protectedTargets, runtimeWrites, phase, approvedGroups = [], sdkLock = null }) {
  if (!['report', 'mutation'].includes(phase) || (phase === 'report' && approvedGroups.length)) throw new Error('Invalid Doctor lease phase');
  canonical(root, realpathSync(root));
  const targets = protectedTargets.map((path) => canonical(path, root));
  const runtime = runtimeWrites.map((path) => {
    canonical(path, root);
    if (!lstatSync(path).isDirectory() || targets.some((target) => inside(path, target) || inside(target, path))) throw new Error('Doctor SDK outputs must be disjoint from protected targets');
    return `(subpath ${JSON.stringify(path)})`;
  });
  if (sdkLock) {
    canonical(sdkLock, root);
    if (!sdkLock.endsWith('/auth.json.lock') || targets.some((target) => inside(sdkLock, target))) throw new Error('Doctor auth lock must be an unprotected exact SDK output');
  }
  const paths = doctorApprovedPaths(approvedGroups, targets, root);
  const lines = readFileSync(doctor.profile, 'utf8').trimEnd().split('\n');
  const grants = lines.filter((line) => line.startsWith('(allow file-write'));
  if (grants.length !== 1 || grants[0] !== lines.at(-1) || lines.filter((line) => line === '(deny file-write*)').length !== 1) throw new Error('Doctor requires the owned offline baseline policy');
  return `${lines.slice(0, -1).join('\n')}\n(deny process-fork)\n(allow file-write* ${runtime.join(' ')} ${sdkLock ? `(literal ${JSON.stringify(sdkLock)})` : ''} (literal "/dev/null"))\n${paths.length ? `(allow file-write-data ${[...new Set(paths)].map((path) => `(literal ${JSON.stringify(path)})`).join(' ')})\n` : ''}`;
}

function writeDoctorLeaseImage({ doctor, directory, policy, phase, approvedGroups }) {
  const profile = join(directory, 'boundary.sb');
  const wrapper = join(directory, 'pi');
  const source = readFileSync(doctor.wrapper, 'utf8');
  const oldProfile = `-f ${quote(doctor.profile)}`;
  if (source.split(oldProfile).length !== 2 || !source.includes('exec /usr/bin/sandbox-exec ')) throw new Error('Doctor requires its protected sandbox launcher');
  writeFileSync(profile, policy, { flag: 'wx', mode: 0o400 });
  writeFileSync(wrapper, source.replace(oldProfile, `-f ${quote(profile)}`), { flag: 'wx', mode: 0o500 });
  writeFileSync(join(directory, 'rpc.jsonl'), '', { flag: 'wx', mode: 0o600 });
  const nativeBoundary = prepareDoctorGuard({ doctor, directory, phase, groups: approvedGroups });
  return { profile, wrapper, nativeBoundary };
}

export function prepareDoctorLease({ doctor, root, protectedTargets, phase, sessionId, approvedGroups = [], rootState = null }) {
  if (!doctor.sessionOptions || doctor.session) throw new Error('Doctor requires deferred fixture preparation before the first SUT launch');
  const owned = realpathSync(root);
  const out = realpathSync(doctor.out);
  if (inside(out, owned)) throw new Error('Doctor policies and evidence must be outside the agent write root');
  const directory = join(out, 'leases', `${phase}-${randomUUID()}`);
  const sessionDir = join(doctor.agentDir, 'sessions', `--${doctor.cwd.replace(/^[/\\]/, '').replace(/[/\\:]/g, '-')}--`);
  const tmp = join(owned, 'doctor-runtime', phase);
  for (const path of [directory, sessionDir, tmp]) mkdirSync(path, { recursive: true });
  const auth = join(doctor.agentDir, 'auth.json');
  if (!existsSync(auth)) writeFileSync(auth, '{}', { flag: 'wx', mode: 0o600 });
  const sdkLock = `${auth}.lock`;
  const policy = doctorLeasePolicy({ doctor, root: owned, protectedTargets, runtimeWrites: [sessionDir, tmp], phase, approvedGroups, sdkLock });
  const { profile, wrapper, nativeBoundary } = writeDoctorLeaseImage({ doctor, directory, policy, phase, approvedGroups });
  const record = freeze({
    id: dirname(profile),
    phase,
    sessionId,
    rootState: structuredClone(rootState),
    reportArtifactSha256: rootState?.reportArtifact?.sha256 ?? null,
    profile,
    wrapper,
    profileSha256: doctorDigest(policy),
    imageSha256: doctorDigest(readFileSync(wrapper)),
    piImage: { path: realpathSync(doctor.imagePath), sha256: doctorDigest(readFileSync(doctor.imagePath)) },
    authority: 'parent-owned-sandbox-exec',
    nativeBoundary,
    root: owned,
    cwd: doctor.cwd,
    protectedTargets: [...protectedTargets],
    runtimeWrites: [sessionDir, tmp],
    sdkLock,
    approvedGroups: structuredClone(approvedGroups),
  });
  return {
    record,
    options: {
      ...doctor.sessionOptions,
      piBin: wrapper,
      persistSession: true,
      sessionId,
      env: { ...doctor.env, TMPDIR: tmp },
      capturePath: join(directory, 'rpc.jsonl'),
      packagePath: nativeBoundary.path,
      extraExtensions: [doctor.sessionOptions.packagePath, ...(doctor.sessionOptions.extraExtensions ?? [])],
      idleTimeoutMs: 120000,
    },
  };
}

export function openDoctorLease(prepared) {
  if (doctorDigest(readFileSync(prepared.record.piImage.path)) !== prepared.record.piImage.sha256 || doctorDigest(readFileSync(prepared.record.nativeBoundary.sdk.path)) !== prepared.record.nativeBoundary.sdk.sha256)
    throw new Error('Doctor protected SDK or Pi image changed');
  if (doctorDigest(readFileSync(prepared.record.nativeBoundary.runtime.path)) !== prepared.record.nativeBoundary.runtime.sha256) throw new Error('Doctor protected native boundary runtime changed');
  if (doctorDigest(readFileSync(prepared.record.nativeBoundary.path)) !== prepared.record.nativeBoundary.sha256) throw new Error('Doctor protected native boundary image changed');
  if (doctorDigest(readFileSync(prepared.record.profile)) !== prepared.record.profileSha256 || doctorDigest(readFileSync(prepared.record.wrapper)) !== prepared.record.imageSha256) throw new Error('Doctor immutable lease image changed');
  const session = createRpcSession(prepared.options);
  return { session, record: freeze({ ...prepared.record, pid: session.pid, startedAt: new Date().toISOString() }) };
}

export async function drainDoctorLease(lease) {
  await lease.session.close();
  if (lease.session.pid !== null) throw new Error('Doctor RPC client did not drain');
  const shutdownErrors = lease.session.records.filter((record) => record.type === 'rpc_shutdown_error');
  return freeze({ ...lease.record, endedAt: new Date().toISOString(), drained: true, shutdownErrors });
}

export function doctorLeaseJournal(records, lease, { offset = 0, reportIndex = null, approvedGroups = [] } = {}) {
  const starts = Map.groupBy(
    records.filter((record) => record.type === 'tool_execution_start'),
    (record) => record.toolCallId,
  );
  const ends = Map.groupBy(
    records.map((record, index) => ({ record, index })).filter((item) => item.record.type === 'tool_execution_end'),
    (item) => item.record.toolCallId,
  );
  const calls = records.flatMap((record, index) => {
    if (record.type !== 'tool_execution_start') return [];
    const matches = ends.get(record.toolCallId) ?? [];
    const end = matches.length === 1 && matches[0].index > index && starts.get(record.toolCallId).length === 1 ? matches[0].record : null;
    const path = typeof record.args?.path === 'string' ? resolve(lease.cwd ?? lease.root, record.args.path) : null;
    return [{ index: offset + index, toolCallId: record.toolCallId, kind: record.toolName, path, succeeded: end?.isError === false, ended: Boolean(end), actor: 'doctor' }];
  });
  const writes = calls.filter((call) => ['write', 'edit'].includes(call.kind));
  const unknownCalls = calls.filter((call) => !['read', 'write', 'edit'].includes(call.kind) || !call.ended).map((call) => call.toolCallId);
  const attempts = writes.filter((call) => lease.phase === 'report' || !call.succeeded || !approvedGroups.some((group) => group.paths.includes(call.path)));
  const entries = writes.map((call) => {
    const group = approvedGroups.find((item) => item.paths.includes(call.path));
    return { ...call, attemptedGroupId: group?.id ?? null, groupId: call.succeeded ? (group?.id ?? null) : null, effect: group?.effect ?? null };
  });
  const complete = lease.drained === true && lease.shutdownErrors.length === 0 && unknownCalls.length === 0;
  return { complete, proof: { kind: 'immutable-kernel-capability-and-native-tool-contract', leaseId: lease.id, profileSha256: lease.profileSha256, syscallTrace: false, reportIndex }, entries, calls, unknownCalls, violations: attempts };
}
