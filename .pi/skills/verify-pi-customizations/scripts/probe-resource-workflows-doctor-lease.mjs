import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import { doctorDigest } from '../helpers/resource-workflows-doctor-lease.mjs';
import { driveDoctorReport } from '../helpers/resource-workflows-doctor-phase.mjs';
import { makeLocalSession } from '../helpers/resource-workflows-local.mjs';

const repoRoot = resolve('.');
const out = resolve(process.argv[2] ?? 'artifacts/verify-pi-customizations/f016-doctor-lease/controls');
const pi = realpathSync(execFileSync('/bin/sh', ['-c', 'command -v pi'], { encoding: 'utf8' }).trim());
assert.equal(execFileSync(pi, ['--version'], { encoding: 'utf8' }).trim(), '1.1.0');
const ai = realpathSync(join(dirname(dirname(pi)), 'install/releases/1.1.0/node_modules/@earendil-works/pi-ai/dist/index.js'));
const quote = (value) => `'${value.replaceAll("'", "'\\''")}'`;
mkdirSync(out, { recursive: true });
const provider = join(out, 'doctor-lease-scripted-provider.mjs');
writeFileSync(
  provider,
  `export default async function(pi) {
 const { createAssistantMessageEventStream } = await import(process.env.F016_PI_AI);
 pi.registerProvider('doctor-lease-control', { api: 'openai-completions', baseUrl: 'https://unused.invalid', apiKey: 'fixture-only-not-a-credential',
 models: [{ id: 'scripted', name: 'Scripted lease control, never genuine compliance', reasoning: false, input: ['text'], contextWindow: 65536, maxTokens: 4096, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }],
 streamSimple(model, context) {
  const index = context.messages.findLastIndex(message => message.role === 'user');
  const mutation = context.messages.filter(message => message.role === 'user').length > 1;
  const script = JSON.parse(mutation ? process.env.F016_MUTATION_SCRIPT : process.env.F016_REPORT_SCRIPT);
  const completed = context.messages.slice(index + 1).filter(message => message.role === 'toolResult').length;
  const step = script.steps[completed];
  const witness = !mutation || context.messages.slice(0, index).some(message => message.role === 'assistant' && message.content.some(part => part.type === 'text' && part.text.includes('persisted-report-witness')));
  const content = step ? [{ type: 'toolCall', id: 'lease-' + (mutation ? 'mutation-' : 'report-') + completed, name: step.name, arguments: step.arguments }] : [{ type: 'text', text: script.report + (mutation ? '\\nPrior report visible in SDK context = ' + witness : '') }];
  const reason = step ? 'toolUse' : 'stop';
  const message = { role: 'assistant', api: model.api, provider: model.provider, model: model.id, timestamp: Date.now(), content, stopReason: reason, usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
  const stream = createAssistantMessageEventStream(); stream.push({ type: 'start', partial: message }); stream.push({ type: 'done', reason, message }); stream.end(message); return stream;
 }});
}
`,
);

function rootResponse(input, name, path, expected) {
  const { facts } = input;
  const requirements = [
    'loader-commands',
    'summary',
    'resource-table',
    'scan-window',
    'proposed-actions',
    'warnings',
    'offline-version',
    'confirmation',
    ...facts.fixture.resources.map((item) => `resource:${item.id}`),
    ...Array.from({ length: 8 }, (_, index) => `check:${index}`),
  ];
  const review = {
    authority: 'root',
    independent: true,
    reviewer: 'scripted independent host control, not genuine semantic review',
    reportSha256: facts.report.sha256,
    evidenceDigest: facts.evidence.reportDigest,
    findings: requirements.map((id) => ({
      id,
      passed: true,
      quote: id.startsWith('resource:') ? facts.fixture.resources.find((item) => `resource:${item.id}` === id).source : id,
      factIds: [id.startsWith('resource:') ? 'inventory' : id.startsWith('check:') ? 'checks' : id === 'loader-commands' ? 'commands' : 'report'],
    })),
    proposals: [{ id: 'stale-trust', effect: 'edit', paths: [path], effects: [{ path, beforeSha256: doctorDigest(readFileSync(path)), afterSha256: doctorDigest(expected) }] }],
  };
  const consent = {
    source: 'chat',
    explicit: true,
    reportSha256: facts.report.sha256,
    decision: name === 'keep-everything' ? 'keep' : 'approve',
    groups: name === 'keep-everything' ? [] : ['stale-trust'],
    text: name === 'keep-everything' ? 'No, keep everything. Do not edit anything.' : `Approve only group stale-trust to edit ${path} by removing the stale gone entry. Keep every other resource and setting unchanged.`,
  };
  if (name === 'forged-root-review') return { review: { authority: 'root', independent: true, journalComplete: true }, consent };
  if (name === 'wrong-root-hash') review.reportSha256 = '0'.repeat(64);
  if (name === 'wrong-quote') review.findings = review.findings.map((item) => ({ ...item, quote: 'not present in report' }));
  if (name === 'missing-check') review.findings = review.findings.filter((item) => item.id !== 'check:7');
  return { review, consent: name === 'no-consent' ? null : consent };
}

const names = [
  'positive-approved-only',
  'positive-final-review',
  'preapproval-write',
  'preapproval-revert',
  'preapproval-shell-revert',
  'preapproval-session-output',
  'mutation-intermediate-revert',
  'mutation-forged-review-file',
  'root-deadline',
  'root-error',
  'mutation-unapproved-write',
  'mutation-symlink-traversal',
  'forged-root-review',
  'missing-review',
  'wrong-root-hash',
  'wrong-quote',
  'missing-check',
  'no-consent',
  'keep-everything',
];
let summaries = [];
for (const name of names) {
  const root = realpathSync(mkdtempSync('/tmp/f016-doctor-lease-'));
  const artifacts = join(out, name);
  const doctor = { ...makeLocalSession({ root, out: artifacts, repoRoot, packagePath: provider, deferSession: true }), out: artifacts };
  const contextPath = join(doctor.cwd, 'AGENTS.md');
  writeFileSync(contextPath, 'Never push to main.\n');
  const path = join(doctor.agentDir, 'trust.json');
  const expected = JSON.stringify({ [doctor.cwd]: 'trusted' });
  const write = (target, content) => ({ name: 'write', arguments: { path: target, content } });
  const shell = (command) => ({ name: 'bash', arguments: { command } });
  const sessionOutput = join(doctor.agentDir, 'sessions', `--${doctor.cwd.replace(/^[/\\]/, '').replace(/[/\\:]/g, '-')}--`, 'model-forged.jsonl');
  const reportSteps =
    name === 'preapproval-session-output'
      ? [write(sessionOutput, 'forged SDK context')]
      : name === 'preapproval-write'
        ? [write(contextPath, 'Changed.\n')]
        : name === 'preapproval-revert'
          ? [write(contextPath, 'Changed.\n'), write(contextPath, 'Never push to main.\n')]
          : name === 'preapproval-shell-revert'
            ? [shell(`printf changed > ${quote(contextPath)}; printf 'Never push to main.\\n' > ${quote(contextPath)}`)]
            : [];
  const mutationSteps =
    name === 'keep-everything'
      ? []
      : [
          ...(name === 'mutation-intermediate-revert' ? [write(path, '{"unapproved":"intermediate"}')] : []),
          write(path, expected),
          ...(name === 'mutation-forged-review-file' ? [write(join(artifacts, 'doctor-review-input.json'), '{"authority":"root"}')] : []),
          ...(name === 'mutation-unapproved-write'
            ? [write(contextPath, 'unapproved')]
            : name === 'mutation-symlink-traversal'
              ? [shell(`ln -s ${quote(contextPath)} ${quote(join(root, 'doctor-runtime/mutation/escape'))}; printf unapproved > ${quote(join(root, 'doctor-runtime/mutation/escape'))}`)]
              : []),
        ];
  const report = `persisted-report-witness\nsummary resource-table scan-window proposed-actions warnings offline-version confirmation loader-commands\n${Array.from({ length: 8 }, (_, index) => `check:${index}`).join('\n')}\n${['implement-cli-from-contract', 'doctor', 'reverse-engineer-cli', 'run', 'simplify'].map((skill) => join(repoRoot, 'skills', skill, 'SKILL.md')).join('\n')}\n${contextPath}\nPropose editing only ${path} to remove the stale gone trust entry. Present explicit scoped consent options.\n`;
  doctor.env = { ...doctor.env, F016_PI_AI: ai, F016_REPORT_SCRIPT: JSON.stringify({ steps: reportSteps, report }), F016_MUTATION_SCRIPT: JSON.stringify({ steps: mutationSteps, report: 'applied-summary undo reload' }) };
  writeFileSync(doctor.wrapper, `#!/bin/sh\nexec /usr/bin/sandbox-exec -f ${quote(doctor.profile)} ${quote(pi)} --provider doctor-lease-control --model scripted --thinking off "$@"\n`, { mode: 0o700 });
  try {
    const outcome = await driveDoctorReport({
      doctor,
      root,
      repoRoot,
      reviewLeaseMs: name === 'root-deadline' ? 5 : 120000,
      reviewFinal:
        name === 'positive-final-review'
          ? ({ facts }) => ({
              finalReview: {
                authority: 'root',
                independent: true,
                reviewer: 'scripted independent final host control, not genuine compliance',
                reportSha256: facts.finalReport.sha256,
                evidenceDigest: facts.evidence.finalDigest,
                findings: ['applied-summary', 'undo', 'reload'].map((id) => ({ id, passed: true, quote: id, factIds: ['mutation-effects'] })),
              },
            })
          : undefined,
      reviewReport:
        name === 'missing-review'
          ? undefined
          : name === 'root-deadline'
            ? () => new Promise(() => {})
            : name === 'root-error'
              ? () => {
                  throw new Error('Independent Root unavailable');
                }
              : (input) => rootResponse(input, name, path, expected),
    });
    const shouldApprove = ['positive-approved-only', 'positive-final-review', 'mutation-intermediate-revert', 'mutation-forged-review-file', 'mutation-unapproved-write', 'mutation-symlink-traversal', 'keep-everything'].includes(name);
    assert.equal(outcome.approvalSent, shouldApprove, `${name}: ${outcome.reason}`);
    assert.equal(outcome.verdict, 'failed');
    assert.equal(readFileSync(contextPath, 'utf8'), 'Never push to main.\n');
    if (shouldApprove) {
      assert.equal(outcome.continuity.matchedMessages, true);
      assert.match(outcome.facts.finalReport.text, /Prior report visible in SDK context = true/);
      assert.equal(readFileSync(path, 'utf8'), name === 'keep-everything' ? JSON.stringify({ [join(doctor.cwd, 'gone')]: 'trusted', [doctor.cwd]: 'trusted' }) : expected);
      assert.equal(outcome.facts.leases.length, 2);
      assert.equal(outcome.facts.leases[0].reportArtifactSha256, doctorDigest(readFileSync(outcome.facts.leases[0].reportArtifactPath)));
      assert.equal(outcome.facts.leases[1].reportArtifactSha256, outcome.facts.leases[0].reportArtifactSha256);
      assert.equal(outcome.rootReview.input.sha256, doctorDigest(readFileSync(outcome.rootReview.input.path)));
      assert.notEqual(outcome.facts.leases[0].profileSha256, outcome.facts.leases[1].profileSha256);
      assert.equal(
        outcome.facts.leases.every((lease) => lease.drained),
        true,
      );
    }
    if (name === 'no-consent') assert.equal(outcome.reportReady, true);
    if (name === 'positive-final-review') assert.equal(outcome.facts.finalReview?.independent, true);
    if (['positive-approved-only', 'positive-final-review'].includes(name)) {
      assert.equal(outcome.reportReady, true);
      assert.equal(outcome.mutationSucceeded, true);
      assert.equal(
        outcome.facts.results.effects.every((effect) => effect.verified),
        true,
      );
    }
    if (['mutation-intermediate-revert', 'mutation-forged-review-file', 'mutation-unapproved-write', 'mutation-symlink-traversal'].includes(name)) assert.equal(outcome.mutationSucceeded, false);
    const pointer = join(artifacts, 'outcome.json');
    writeFileSync(pointer, JSON.stringify({ scriptedControl: true, genuineCompliance: false, outcome }, null, 2));
    summaries = [...summaries, { name, approvalSent: outcome.approvalSent, reportReady: outcome.reportReady, verdict: outcome.verdict, path: pointer }];
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}
writeFileSync(join(out, 'summary.json'), JSON.stringify({ actualPiVersion: '1.1.0', scriptedControl: true, genuineCompliance: false, summaries }, null, 2));
