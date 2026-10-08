import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { createDoctorEvidence, doctorAnswers } from './resource-workflows-doctor-evidence.mjs';
import { boundDoctorOperation } from './resource-workflows-doctor-lease-phase.mjs';
import { doctorDigest, doctorLeaseJournal } from './resource-workflows-doctor-lease.mjs';
import { evaluateDoctor } from './resource-workflows-doctor-outcome.mjs';
import { openDoctorReadonlyLease } from './resource-workflows-doctor-readonly-lease.mjs';

export async function driveDoctorReadonlyReport({ doctor, repoRoot, root, promptDeadlineMs = 120000 }) {
  if (!Number.isInteger(promptDeadlineMs) || promptDeadlineMs < 1 || promptDeadlineMs > 120000) throw new Error('Doctor readonly deadline must fit the existing 120 second prompt budget');
  const deadline = performance.now() + promptDeadlineMs;
  const owned = realpathSync(root);
  doctor = { ...doctor, cwd: realpathSync(doctor.cwd), agentDir: realpathSync(doctor.agentDir), sessionOptions: { ...doctor.sessionOptions, answers: doctorAnswers() } };
  const targets = [join(doctor.agentDir, 'settings.json'), join(doctor.agentDir, 'trust.json'), join(doctor.agentDir, 'skills'), join(doctor.agentDir, 'AGENTS.md'), join(doctor.cwd, 'AGENTS.md'), join(doctor.cwd, '.pi')];
  const lease = openDoctorReadonlyLease({ doctor, repoRoot, root: owned, protectedTargets: targets, phase: 'report', sessionId: randomUUID(), deadline });
  const observer = createDoctorEvidence({ root: owned, cwd: doctor.cwd, targets, out: doctor.out, records: () => lease.session.records });
  try {
    const prompt = `/skill:doctor Check the actual Pi setup at ${doctor.agentDir} for ${doctor.cwd} offline. Invoke doctor_readonly with operation gather. Use its actual loader, inventory, source-bound hashes, and the bundled eight-check contract to present the complete health report before any change. No action group has been approved. This main lease forbids shell and every mutation. The readonly broker accepts only its fixed operation enum. Unknown dialogs are denied or cancelled.`;
    const invoked = await boundDoctorOperation(() => lease.session.prompt(prompt), Math.max(1, Math.floor(deadline - performance.now())), 'Doctor report prompt');
    const ended = await lease.close();
    const records = lease.session.records;
    const text = records.filter((record) => record.type === 'message_end' && record.message?.role === 'assistant').flatMap((record) => record.message.content ?? []).filter((part) => part.type === 'text').map((part) => part.text).join('\n');
    const report = observer.checkpoint('report', text);
    const gather = ended.readonlyBroker.calls.find((call) => call.operation === 'gather' && call.correlated === true);
    const execution = gather?.receipt?.execution;
    const inventory = execution?.evidence?.sourceBound === true ? execution.inventoryWindow?.inventory ?? null : null;
    const artifacts = [{ id: 'report', path: report.path, sha256: report.sha256 }];
    if (gather?.receipt?.artifact) artifacts.push({ id: 'agent-gather', ...gather.receipt.artifact });
    const resources = inventory ? [
      ...(inventory.skills ?? []).map((item) => ({ id: `skill:${item.path}`, type: 'skill', source: item.path })),
      ...(inventory.packages ?? []).map((item, index) => ({ id: `package:${index}`, type: 'package', source: typeof item === 'string' ? item : (item.source ?? item.path) })),
      ...targets.filter((path) => path.endsWith('AGENTS.md') && existsSync(path)).map((path) => ({ id: `context:${path}`, type: 'context', source: path })),
    ] : [];
    const facts = {
      attemptId: 'setup', scope: { root: owned, targets, identities: report.identities },
      fixture: inventory?.partial === false && execution?.evidence?.sourceBound === true ? { resources, checks: Array.from({ length: 8 }, (_, id) => ({ id: `check:${id}`, contract: 'checks' })), window: { files: inventory.usage?.window?.files, days: execution.inventoryWindow.days }, offline: true } : null,
      invocation: { error: invoked.error ?? gather?.receipt?.error ?? (!gather ? 'Agent did not complete an authenticated gather call' : execution?.evidenceError ?? null) },
      report: { text, sha256: report.reportSha256, index: report.index }, evidence: { reportDigest: report.sha256, artifacts },
      review: null, journal: doctorLeaseJournal(records, ended), leases: [ended], dialogs: lease.session.dialogs, confirmation: null, finalReview: null,
      results: { effects: [], loading: null }, cleanup: {
        agent: null, observed: { mainDrained: ended.drained, boundedOperations: ended.readonlyBroker.calls.map((call) => ({ toolCallId: call.toolCallId, synchronousCompletion: call.receipt?.synchronousCompletion ?? false })) },
        rescue: { performed: Boolean(invoked.error || ended.shutdownErrors.length || ended.readonlyBroker.calls.some((call) => call.receipt?.rescued)) },
      },
    };
    const result = { ...evaluateDoctor(facts), facts, genuineCompliance: false, F009: 'OPEN', F016: 'OPEN', phase: 'readonly-descendant-proof-required', approvalSent: false,
      pending: ['confined descendant ownership and actual exit proof', 'independent evidence-linked Root audit', 'explicit scoped chat consent', 'agent cleanup attribution without confusing main harness drain with agent termination'] };
    const path = join(doctor.out, 'doctor-readonly-report.json');
    writeFileSync(path, JSON.stringify(result, null, 2), { flag: 'wx', mode: 0o400 });
    return { ...result, protectedReport: { path, sha256: doctorDigest(readFileSync(path)) } };
  } finally { observer.close(); await lease.close(); }
}
