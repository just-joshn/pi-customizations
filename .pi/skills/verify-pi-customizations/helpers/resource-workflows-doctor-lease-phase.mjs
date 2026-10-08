import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { createDoctorEvidence, doctorAnswers } from './resource-workflows-doctor-evidence.mjs';
import { doctorApprovedPaths, doctorDigest, doctorLeaseJournal, drainDoctorLease, openDoctorLease, prepareDoctorLease } from './resource-workflows-doctor-lease.mjs';
import { evaluateDoctor } from './resource-workflows-doctor-outcome.mjs';

const nonempty = (value) => typeof value === 'string' && value.trim().length > 0;
const textSince = (records, start) =>
  records
    .slice(start)
    .filter((record) => record.type === 'message_end' && record.message?.role === 'assistant')
    .flatMap((record) => record.message.content ?? [])
    .filter((part) => part.type === 'text')
    .map((part) => part.text)
    .join('\n');

function publish(out, name, value) {
  const path = join(out, name);
  const content = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  writeFileSync(path, content, { flag: 'wx', mode: 0o400 });
  return { id: name.replace(/\.[^.]+$/, ''), path, sha256: doctorDigest(content) };
}

export async function boundDoctorOperation(operation, ms, description) {
  if (!Number.isInteger(ms) || ms < 1 || ms > 120000) throw new Error('Doctor deadlines must be bounded at 120 seconds');
  const controller = new AbortController();
  let timer;
  try {
    return await Promise.race([
      Promise.resolve()
        .then(() => operation(controller.signal))
        .then((value) => ({ value, error: null })),
      new Promise((resolve) => {
        timer = setTimeout(() => {
          controller.abort();
          resolve({ value: null, error: `${description} deadline expired` });
        }, ms);
      }),
    ]);
  } catch (error) {
    return { value: null, error: error.message };
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}

async function invokeDoctor(session, prompt, deadlineMs, description) {
  const start = session.records.length;
  const invoked = await boundDoctorOperation(() => session.prompt(prompt), deadlineMs, description);
  const failed = session.records.slice(start).find((record) => record.type === 'message_end' && record.message?.role === 'assistant' && ['error', 'aborted'].includes(record.message.stopReason));
  return { ...invoked, error: invoked.error ?? (failed ? (failed.message.errorMessage ?? `Doctor SDK turn ${failed.message.stopReason}`) : null) };
}

function fixtureTargets(doctor) {
  const stale = join(doctor.cwd, 'gone');
  const trust = join(doctor.agentDir, 'trust.json');
  writeFileSync(trust, JSON.stringify({ [stale]: 'trusted', [doctor.cwd]: 'trusted' }));
  return [trust, join(doctor.agentDir, 'settings.json'), join(doctor.agentDir, 'skills'), join(doctor.agentDir, 'AGENTS.md'), join(doctor.cwd, 'AGENTS.md'), join(doctor.cwd, '.pi')];
}

function manifest(inventory, targets) {
  if (inventory?.partial !== false) return null;
  const skills = (inventory.skills ?? []).map((item) => ({ id: `skill:${item.path}`, type: 'skill', source: item.path }));
  const contexts = targets.filter((path) => path.endsWith('AGENTS.md') && existsSync(path)).map((path) => ({ id: `context:${path}`, type: 'context', source: path }));
  const packages = (inventory.packages ?? []).map((item, index) => ({ id: `package:${index}`, type: 'package', source: typeof item === 'string' ? item : (item.source ?? item.path) }));
  return { resources: [...skills, ...contexts, ...packages], checks: Array.from({ length: 8 }, (_, index) => ({ id: `check:${index}`, contract: 'checks' })), window: { files: inventory.usage?.window?.files, days: 30 }, offline: true };
}

async function collectInputs({ doctor, repoRoot, prepared, session }) {
  let inventory = null;
  let commands = null;
  let error = null;
  let artifacts = [];
  try {
    const probePolicy = publish(doctor.out, 'inventory-policy.sb', readFileSync(prepared.record.profile, 'utf8').replace('(deny process-fork)\n', ''));
    const source = execFileSync(
      '/usr/bin/sandbox-exec',
      ['-f', probePolicy.path, '/usr/bin/python3', join(repoRoot, 'skills/doctor/scripts/inventory.py'), '--agent-dir', doctor.agentDir, '--cwd', doctor.cwd, '--session-dir', join(doctor.agentDir, 'sessions'), '--days', '30'],
      { cwd: doctor.cwd, env: { ...process.env, ...doctor.env, PATH: `${dirname(doctor.imagePath)}:${doctor.env.PATH}` }, encoding: 'utf8', timeout: 30000, maxBuffer: 8388608 },
    );
    inventory = JSON.parse(source);
    commands = await session.commands();
    artifacts = [probePolicy, publish(doctor.out, 'inventory.json', source), publish(doctor.out, 'commands.json', commands), publish(doctor.out, 'checks.md', readFileSync(join(repoRoot, 'skills/doctor/references/checks.md'), 'utf8'))];
  } catch (failure) {
    error = failure.message;
  }
  return { inventory, commands, error, artifacts };
}

function reportFacts({ root, targets, inputs, report, journal, lease, session, error, artifacts }) {
  return {
    attemptId: 'setup',
    scope: { root, targets, identities: report.identities },
    fixture: manifest(inputs.inventory, targets),
    invocation: { error: error ?? inputs.error },
    report: { text: report.text, sha256: report.reportSha256, index: report.index },
    evidence: { reportDigest: report.sha256, artifacts: [...inputs.artifacts, ...artifacts] },
    review: null,
    journal,
    leases: [lease],
    dialogs: session.dialogs,
    confirmation: null,
    finalReview: null,
    results: { effects: [], loading: null },
    cleanup: { agent: null, observed: { reportPid: lease.pid, reportDrained: lease.drained, reportShutdownErrors: lease.shutdownErrors }, rescue: { performed: lease.shutdownErrors.length > 0 } },
  };
}

async function captureLeasedReport({ doctor, repoRoot, root, targets, sessionId, promptDeadlineMs }) {
  const prepared = prepareDoctorLease({ doctor, root, protectedTargets: targets, phase: 'report', sessionId });
  const lease = openDoctorLease(prepared);
  const observer = createDoctorEvidence({ root, cwd: doctor.cwd, targets, out: doctor.out, records: () => lease.session.records });
  try {
    const inputs = await collectInputs({ doctor, repoRoot, prepared, session: lease.session });
    const start = lease.session.records.length;
    const prompt = `/skill:doctor Check my Pi setup at ${doctor.agentDir} for the project ${doctor.cwd}. It is offline. Present the complete health report before changing anything. No action groups have been approved. Use the protected inventory, loader commands, and full eight-check contract at ${doctor.out}. This report lease is read-only. Do not attempt write, edit, shell, or custom tools. Unknown dialogs are denied or cancelled.`;
    const invoked = await invokeDoctor(lease.session, prompt, promptDeadlineMs, 'Doctor report prompt');
    if (invoked.error) await lease.session.close();
    const state = invoked.error ? { sessionId } : await lease.session.state();
    const messages = invoked.error ? [] : await lease.session.messages();
    const ended = await drainDoctorLease(lease);
    const report = observer.checkpoint('report', textSince(lease.session.records, start));
    const sealed = Object.freeze({ ...ended, reportArtifactSha256: report.sha256, reportTextSha256: report.reportSha256, reportArtifactPath: report.path });
    const journal = doctorLeaseJournal(lease.session.records, sealed);
    const artifacts = [publish(doctor.out, 'report-lease.json', sealed), { id: 'report', path: report.path, sha256: report.sha256 }, publish(doctor.out, 'report-session.json', { state, messages })];
    const facts = reportFacts({ root, targets, inputs, report, journal, lease: sealed, session: lease.session, error: invoked.error, artifacts });
    return { facts, inputs, messages, sessionId: state.sessionId, ended: sealed };
  } finally {
    observer.close();
    await lease.session.close();
  }
}

function semanticEvidenceLinks(facts, review) {
  const linked = (id, artifact) => review?.findings?.some((finding) => finding.id === id && finding.passed === true && nonempty(finding.quote) && facts.report.text.includes(finding.quote) && finding.factIds?.includes(artifact));
  return linked('loader-commands', 'commands') && facts.fixture.resources.every((resource) => linked(`resource:${resource.id}`, 'inventory')) && Array.from({ length: 8 }, (_, index) => `check:${index}`).every((id) => linked(id, 'checks'));
}

export function validateDoctorLeaseReview(facts, review) {
  if (facts.journal?.complete !== true || facts.journal.violations?.length !== 0) throw new Error('Root assertions cannot replace Doctor structural boundary proof');
  if (!evaluateDoctor({ ...facts, review }).reportReady || !semanticEvidenceLinks(facts, review)) throw new Error('Independent evidence-linked Root review must pass before mutation lease issuance');
  return { ...structuredClone(review), journalComplete: false };
}

export function validateDoctorLeaseConsent(facts, response) {
  const review = response?.review;
  const consent = response?.consent;
  const acceptedReview = validateDoctorLeaseReview(facts, review);
  if (
    consent?.source !== 'chat' ||
    consent.explicit !== true ||
    !nonempty(consent.text) ||
    consent.reportSha256 !== facts.report.sha256 ||
    !['approve', 'keep'].includes(consent.decision) ||
    !Array.isArray(consent.groups) ||
    new Set(consent.groups).size !== consent.groups.length
  )
    throw new Error('Doctor requires explicit report-linked scoped chat consent');
  if (consent.decision === 'keep' && consent.groups.length) throw new Error('Keep-everything consent cannot approve edits');
  const proposals = review.proposals;
  if (!Array.isArray(proposals) || new Set(proposals.map((item) => item.id)).size !== proposals.length) throw new Error('Root proposals must have unique group identities');
  const groups = consent.groups.map((id) => {
    const group = proposals.find((item) => item.id === id);
    if (group?.effect !== 'edit' || !Array.isArray(group.paths) || !group.paths.length || !Array.isArray(group.effects) || group.effects.length !== group.paths.length)
      throw new Error('Doctor approval requires exact existing-file edit effects');
    doctorApprovedPaths([group], facts.scope.targets, facts.scope.root);
    for (const path of group.paths) {
      const effects = group.effects.filter((effect) => effect.path === path);
      if (
        effects.length !== 1 ||
        effects[0].beforeSha256 !== facts.scope.identities.find((item) => item.path === path)?.sha256 ||
        effects[0].beforeSha256 !== doctorDigest(readFileSync(path)) ||
        !/^[a-f0-9]{64}$/.test(effects[0].afterSha256)
      )
        throw new Error('Doctor approved effects must bind the current bytes and expected result');
    }
    return structuredClone(group);
  });
  return { review: acceptedReview, consent: structuredClone(consent), groups };
}

async function requestRootReview({ doctor, report, reviewReport, reviewLeaseMs }) {
  const input = {
    phase: 'report-ready-parked',
    boundaryReady: report.facts.invocation.error === null && nonempty(report.facts.report.text) && report.facts.journal.complete && report.facts.journal.entries.length === 0,
    facts: report.facts,
    inventory: report.inputs.inventory,
    commands: report.inputs.commands,
    checks: report.inputs.artifacts.find((item) => item.id === 'checks'),
    pending: ['independent semantic report and full inventory review', 'explicit scoped chat consent', 'final effects, effective loading and agent cleanup audit'],
  };
  const pointer = publish(doctor.out, 'doctor-review-input.json', input);
  if (typeof reviewReport !== 'function') return { input: pointer, response: null, error: 'Independent Root review is unavailable' };
  const reviewed = await boundDoctorOperation((signal) => reviewReport(structuredClone({ ...input, protectedInput: pointer }), signal), reviewLeaseMs, 'Doctor Root review');
  const response = reviewed.value ? publish(doctor.out, 'doctor-root-response.json', reviewed.value) : null;
  return { input: pointer, response, value: reviewed.value, error: reviewed.error };
}

function mutationEvidence(doctor, records, lease, journal, groups, before) {
  const files = groups.flatMap((group) => group.paths.map((path) => ({ path, content: readFileSync(path, 'utf8'), sha256: doctorDigest(readFileSync(path)) })));
  const artifact = publish(doctor.out, 'mutation-effects.json', { files, journal, lease, records, before });
  const effects = groups.flatMap((group) =>
    group.effects.map((expected) => ({
      groupId: group.id,
      path: expected.path,
      effect: group.effect,
      verified: files.some((file) => file.path === expected.path && file.sha256 === expected.afterSha256) && journal.entries.some((entry) => entry.path === expected.path && entry.succeeded),
      evidenceId: artifact.id,
    })),
  );
  return { artifact, effects };
}

function consentReceipt(records, start, report, consent) {
  const index = records.findIndex((record, position) => {
    if (position < start || record.type !== 'message_end' || record.message?.role !== 'user') return false;
    const content = record.message.content;
    return (
      (typeof content === 'string'
        ? content
        : content
            ?.filter((part) => part.type === 'text')
            .map((part) => part.text)
            .join('\n')) === consent.text
    );
  });
  const accepted = index >= start && records.slice(start).some((record) => record.type === 'response' && record.command === 'prompt' && record.success === true);
  return { accepted, confirmation: { ...consent, received: accepted, index: report.index + 1 + index } };
}

async function captureMutation({ doctor, root, targets, report, authorized, promptDeadlineMs }) {
  const prepared = prepareDoctorLease({ doctor, root, protectedTargets: targets, phase: 'mutation', sessionId: report.sessionId, approvedGroups: authorized.groups, rootState: authorized.rootState });
  const lease = openDoctorLease(prepared);
  try {
    const state = await lease.session.state();
    const messages = await lease.session.messages();
    if (state.sessionId !== report.sessionId || JSON.stringify(messages) !== JSON.stringify(report.messages)) throw new Error('Doctor persisted SDK session context did not survive the policy transition');
    const start = lease.session.records.length;
    const invoked = await invokeDoctor(lease.session, authorized.consent.text, promptDeadlineMs, 'Doctor mutation prompt');
    const { accepted, confirmation } = consentReceipt(lease.session.records, start, report.facts.report, authorized.consent);
    const text = textSince(lease.session.records, start);
    if (invoked.error) await lease.session.close();
    const commands = invoked.error ? null : await lease.session.commands();
    const ended = await drainDoctorLease(lease);
    const journal = doctorLeaseJournal(lease.session.records, ended, { offset: report.facts.report.index + 1, reportIndex: report.facts.report.index, approvedGroups: authorized.groups });
    const evidence = mutationEvidence(doctor, lease.session.records, ended, journal, authorized.groups, { state, messages });
    const finalReport = publish(doctor.out, 'final-report.txt', text);
    const loading = publish(doctor.out, 'effective-loader.json', { commands, agentPerformed: false, inventoryRerun: false });
    const facts = {
      ...report.facts,
      review: authorized.review,
      confirmation,
      invocation: { error: invoked.error },
      leases: [...report.facts.leases, ended],
      journal: { ...journal, complete: report.facts.journal.complete && journal.complete, entries: [...report.facts.journal.entries, ...journal.entries], unknownCalls: [...report.facts.journal.unknownCalls, ...journal.unknownCalls] },
      dialogs: [...report.facts.dialogs, ...lease.session.dialogs],
      finalReport: { text, sha256: finalReport.sha256 },
      evidence: { ...report.facts.evidence, finalDigest: evidence.artifact.sha256, artifacts: [...report.facts.evidence.artifacts, evidence.artifact, finalReport, loading] },
      results: { effects: evidence.effects, loading: { evidenceId: loading.id, agentPerformed: false, inventoryRerun: false } },
      cleanup: {
        ...report.facts.cleanup,
        observed: { ...report.facts.cleanup.observed, mutationPid: ended.pid, mutationDrained: ended.drained, mutationShutdownErrors: ended.shutdownErrors },
        rescue: { performed: report.facts.cleanup.rescue.performed || ended.shutdownErrors.length > 0 },
      },
    };
    return {
      facts,
      continuity: { sessionId: state.sessionId, matchedMessages: true },
      error: invoked.error,
      approvalSent: accepted,
      mutationSucceeded: accepted && invoked.error === null && journal.complete && journal.violations.length === 0 && evidence.effects.every((effect) => effect.verified),
    };
  } finally {
    await lease.session.close();
  }
}

export async function driveDoctorLeases({ doctor, repoRoot, root, reviewReport, reviewFinal, reviewLeaseMs = 120000, promptDeadlineMs = 120000 }) {
  if (!Number.isInteger(reviewLeaseMs) || reviewLeaseMs < 1 || reviewLeaseMs > 120000 || !Number.isInteger(promptDeadlineMs) || promptDeadlineMs < 1 || promptDeadlineMs > 120000)
    throw new Error('Doctor deadlines must be bounded at 120 seconds');
  const owned = realpathSync(root);
  const answers = doctorAnswers();
  doctor = { ...doctor, cwd: realpathSync(doctor.cwd), agentDir: realpathSync(doctor.agentDir), sessionOptions: { ...doctor.sessionOptions, answers } };
  const targets = fixtureTargets(doctor);
  const report = await captureLeasedReport({ doctor, repoRoot, root: owned, targets, sessionId: randomUUID(), promptDeadlineMs });
  const rootReview = await requestRootReview({ doctor, report, reviewReport, reviewLeaseMs });
  let authorized;
  let reviewedFacts = report.facts;
  try {
    reviewedFacts = { ...report.facts, review: validateDoctorLeaseReview(report.facts, rootReview.value?.review) };
    authorized = {
      ...validateDoctorLeaseConsent(report.facts, rootReview.value),
      rootState: { input: rootReview.input, response: rootReview.response, reportSha256: report.facts.report.sha256, reportArtifact: report.facts.evidence.artifacts.find((item) => item.id === 'report') },
    };
  } catch (error) {
    return { ...evaluateDoctor(reviewedFacts), facts: reviewedFacts, phase: reviewedFacts.review ? 'awaiting-consent' : 'awaiting-root-review', rootReview, approvalSent: false, reason: rootReview.error ?? error.message };
  }
  const mutation = await captureMutation({ doctor, root: owned, targets, report, authorized, promptDeadlineMs });
  let facts = mutation.facts;
  let finalReviewError = null;
  const finalInput = publish(doctor.out, 'doctor-final-review-input.json', { phase: 'mutation-complete', facts, continuity: mutation.continuity, rootReview });
  if (typeof reviewFinal === 'function') {
    const reviewed = await boundDoctorOperation((signal) => reviewFinal(structuredClone({ facts, protectedInput: finalInput }), signal), reviewLeaseMs, 'Doctor final review');
    finalReviewError = reviewed.error;
    if (reviewed.value) {
      publish(doctor.out, 'doctor-final-root-response.json', reviewed.value);
      facts = { ...facts, finalReview: reviewed.value.finalReview ?? null };
    }
  }
  return {
    ...evaluateDoctor(facts),
    facts,
    phase: mutation.mutationSucceeded ? 'mutation-complete-audit-required' : 'mutation-failed',
    mutationSucceeded: mutation.mutationSucceeded,
    rootReview,
    continuity: mutation.continuity,
    approvalSent: mutation.approvalSent,
    finalReviewError,
    pending: ['agent-performed effective loading when required', 'agent cleanup attribution before harness rescue', 'independent genuine final audit'],
  };
}
