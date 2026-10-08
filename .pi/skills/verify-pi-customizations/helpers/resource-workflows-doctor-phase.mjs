import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { createDoctorEvidence } from './resource-workflows-doctor-evidence.mjs';
import { driveDoctorLeases } from './resource-workflows-doctor-lease-phase.mjs';
import { evaluateDoctor } from './resource-workflows-doctor-outcome.mjs';
import { attemptPrompt } from './resource-workflows-local.mjs';

const textSince = (records, index) =>
  records
    .slice(index)
    .filter((record) => record.type === 'message_end' && record.message?.role === 'assistant')
    .flatMap((record) => record.message.content ?? [])
    .filter((part) => part.type === 'text')
    .map((part) => part.text)
    .join('\n');

async function boundedReview(reviewReport, input, leaseMs) {
  if (typeof reviewReport !== 'function') return { response: null, error: 'Independent Root review is unavailable.' };
  const controller = new AbortController();
  let timer;
  try {
    return await Promise.race([
      Promise.resolve()
        .then(() => reviewReport(structuredClone(input), controller.signal))
        .then((response) => ({ response, error: null })),
      new Promise((resolve) => {
        timer = setTimeout(() => {
          controller.abort();
          resolve({ response: null, error: 'Root report review lease expired.' });
        }, leaseMs);
      }),
    ]);
  } catch (error) {
    return { response: null, error: error.message };
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}

export async function driveDoctorReport({ doctor, repoRoot, root, reviewReport, reviewFinal, reviewLeaseMs = 120000, promptDeadlineMs = 120000 }) {
  if (doctor.sessionOptions && doctor.session === null) return driveDoctorLeases({ doctor, repoRoot, root, reviewReport, reviewFinal, reviewLeaseMs, promptDeadlineMs });
  if (!Number.isInteger(reviewLeaseMs) || reviewLeaseMs < 1 || reviewLeaseMs > 120000) throw new Error('Doctor Root review lease must be bounded at 120 seconds');
  const ownedRoot = realpathSync(root);
  doctor = { ...doctor, cwd: realpathSync(doctor.cwd), agentDir: realpathSync(doctor.agentDir) };
  const trust = join(doctor.agentDir, 'trust.json');
  const stale = join(doctor.cwd, 'gone');
  writeFileSync(trust, JSON.stringify({ [stale]: 'trusted', [doctor.cwd]: 'trusted' }));
  mkdirSync(join(doctor.cwd, '.pi'), { recursive: true });
  const targets = [trust, join(doctor.agentDir, 'settings.json'), join(doctor.agentDir, 'skills'), join(doctor.agentDir, 'AGENTS.md'), join(doctor.cwd, 'AGENTS.md'), join(doctor.cwd, '.pi/settings.json')];
  const observer = createDoctorEvidence({ root: ownedRoot, cwd: doctor.cwd, targets, out: doctor.out, records: () => doctor.session.records });
  try {
    let inventory = null;
    let inventoryError = null;
    let commands = null;
    try {
      const source = execFileSync(
        '/usr/bin/sandbox-exec',
        ['-f', doctor.profile, 'python3', join(repoRoot, 'skills/doctor/scripts/inventory.py'), '--agent-dir', doctor.agentDir, '--cwd', doctor.cwd, '--session-dir', join(doctor.agentDir, 'sessions'), '--days', '30'],
        { cwd: doctor.cwd, env: { ...process.env, ...doctor.env }, encoding: 'utf8', timeout: 30000, maxBuffer: 8388608 },
      );
      inventory = JSON.parse(source);
      writeFileSync(join(doctor.out, 'fixture-inventory.json'), source);
      commands = await doctor.session.commands();
      writeFileSync(join(doctor.out, 'loader-commands.json'), JSON.stringify(commands, null, 2));
      cpSync(join(repoRoot, 'skills/doctor/references/checks.md'), join(doctor.out, 'check-contract.md'));
    } catch (error) {
      inventoryError = error.message;
    }
    const start = doctor.session.records.length;
    const error = await attemptPrompt(
      doctor.session,
      `/skill:doctor Check my Pi setup at ${doctor.agentDir} for the project ${doctor.cwd}. It is offline. Present your complete health report before changing anything. No action groups have been approved. Unknown dialogs will be denied or cancelled.`,
    );
    const report = observer.checkpoint('report', textSince(doctor.session.records, start));
    const facts = {
      attemptId: 'setup',
      scope: { root: ownedRoot, targets },
      fixture: null,
      invocation: { error },
      report: { text: report.text, sha256: report.reportSha256, index: report.index },
      evidence: { reportDigest: report.sha256, artifacts: [{ id: 'report', sha256: report.sha256, path: report.path }] },
      review: null,
      journal: { ...report.journal, complete: false },
      dialogs: doctor.session.dialogs ?? [],
      confirmation: null,
      finalReview: null,
      results: { effects: [], loading: null },
      cleanup: { agent: null, rescue: { performed: false } },
    };
    const input = {
      phase: 'report-captured',
      facts,
      inventory,
      inventoryError,
      commands,
      paths: { report: report.path, inventory: join(doctor.out, 'fixture-inventory.json'), commands: join(doctor.out, 'loader-commands.json'), checks: join(doctor.out, 'check-contract.md') },
      pending: ['independent evidence-linked inventory and report review', 'complete bounded journal attribution proof', 'exact scoped chat confirmation', 'final review, effects, loading verification and agent cleanup'],
    };
    writeFileSync(join(doctor.out, 'doctor-review-input.json'), JSON.stringify(input, null, 2));
    const reviewed = await boundedReview(reviewReport, input, reviewLeaseMs);
    if (reviewed.response) writeFileSync(join(doctor.out, 'doctor-root-response.json'), JSON.stringify(reviewed.response, null, 2));
    // Notifications and a Root boolean cannot prove the writable lease journal complete.
    const outcome = evaluateDoctor(facts);
    cpSync(doctor.agentDir, join(doctor.out, 'agent'), { recursive: true });
    return {
      ...outcome,
      facts,
      phase: 'journal-proof-required',
      inventoryError,
      reviewError: reviewed.error,
      approvalSent: false,
      reason: `${outcome.reason} Report captured for independent Root review. Approval is blocked until an immutable report lease or complete attributed journal proves the pre-approval boundary. Snapshot/FSEvent notifications and journalComplete assertions are not that proof.`,
    };
  } finally {
    observer.close();
    await doctor.session.close();
  }
}
