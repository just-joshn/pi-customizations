import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { doctorDigest, drainDoctorLease, openDoctorLease, prepareDoctorLease } from './resource-workflows-doctor-lease.mjs';
import { attachDoctorReadonlyChannel } from './resource-workflows-doctor-readonly-channel.mjs';
import { prepareDoctorReadonlyOperations } from './resource-workflows-doctor-readonly-loader.mjs';
import { createDoctorReadonlyAuthority } from './resource-workflows-doctor-readonly.mjs';

export function openDoctorReadonlyLease({ doctor, repoRoot, root, protectedTargets, phase, sessionId, approvedGroups = [], rootState = null, deadline, expectedSettingsSha256 = null }) {
  if (!doctor.sessionOptions || doctor.session) throw new Error('Doctor readonly requires a deferred native lease');
  const prepared = prepareDoctorLease({ doctor, root, protectedTargets, phase, sessionId, approvedGroups, rootState, readonly: true });
  const profile = readFileSync(prepared.record.profile, 'utf8');
  if (!profile.includes('(deny process-fork)\n')) throw new Error('Doctor readonly requires the actual main native nofork capability domain');
  const directory = prepared.record.id;
  const runtimes = ['readonly', 'readonly-channel', 'readonly-loader', 'readonly-lease'].map((name) => {
    const path = fileURLToPath(new URL(`./resource-workflows-doctor-${name}.mjs`, import.meta.url));
    return Object.freeze({ path, sha256: doctorDigest(readFileSync(path)) });
  });
  const operations = prepareDoctorReadonlyOperations({ doctor, repoRoot, root, directory, expectedSettingsSha256 });
  const authority = createDoctorReadonlyAuthority({ operations, deadline, publish(receipt) {
    const path = join(directory, `readonly-${receipt.receiptId}.json`);
    const sealed = Object.freeze({ ...receipt, artifact: { path, sha256: doctorDigest(JSON.stringify(receipt)) } });
    writeFileSync(path, JSON.stringify(receipt), { flag: 'wx', mode: 0o400 });
    return sealed;
  } });
  const channel = attachDoctorReadonlyChannel(authority);
  for (const runtime of runtimes) if (doctorDigest(readFileSync(runtime.path)) !== runtime.sha256) throw new Error('Doctor readonly runtime changed before launch');
  const lease = openDoctorLease({ ...prepared, options: { ...prepared.options, onRecord: channel.onRecord, onChannel: channel.onChannel } });
  let closing = null;
  return Object.freeze({
    session: lease.session, record: lease.record,
    snapshot: authority.snapshot,
    close() {
      closing ??= (async () => {
        try {
          const ended = await drainDoctorLease(lease);
          return Object.freeze({ ...ended, readonlyBroker: authority.snapshot(), nativeDomain: {
            authority: 'parent-source-bound-main-nofork-policy', profile: { path: prepared.record.profile, sha256: prepared.record.profileSha256 },
            nativeBoundary: prepared.record.nativeBoundary, runtimes, nofork: true, tools: ['read', 'write', 'edit', 'doctor_readonly'],
            hostileExtensionIsolation: false, complete: false,
            limitation: 'Extensions share the SDK process and fd3. The channel does not isolate hostile extensions. Direct readonly worker exits do not establish descendant ownership.',
          } });
        } finally { channel.close(); }
      })();
      return closing;
    },
  });
}
