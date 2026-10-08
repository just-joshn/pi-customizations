import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import { createDoctorEvidence, doctorAnswers } from '../helpers/resource-workflows-doctor-evidence.mjs';
import { evaluateDoctor } from '../helpers/resource-workflows-doctor-outcome.mjs';
import { makeLocalSession } from '../helpers/resource-workflows-local.mjs';
import { createRpcSession } from '../lib/rpc.mjs';

const repoRoot = resolve('.');
const out = resolve(process.argv[2] ?? 'artifacts/verify-pi-customizations/f016-doctor-bounded/controls');
mkdirSync(out, { recursive: true });
const pi = realpathSync(execFileSync('/bin/sh', ['-c', 'command -v pi'], { encoding: 'utf8' }).trim());
const version = execFileSync(pi, ['--version'], { encoding: 'utf8' }).trim();
assert.equal(version, '1.1.0');
const ai = realpathSync(join(dirname(dirname(pi)), 'install/releases', version, 'node_modules/@earendil-works/pi-ai/dist/index.js'));
const quote = (value) => `'${value.replaceAll("'", "'\\''")}'`;
const provider = join(out, 'doctor-scripted-provider.mjs');
writeFileSync(
  provider,
  `export default async function(pi) {
 const { createAssistantMessageEventStream } = await import(process.env.F016_PI_AI);
 pi.registerCommand('doctor-probe-dialogs', { description: 'Scripted denial control only', handler: async (_args, ctx) => {
  await ctx.ui.confirm('Unknown cleanup confirmation', 'This must be denied');
  await ctx.ui.select('Unknown cleanup selection', ['Clean up everything (recommended)', 'Let me pick', 'No, keep everything']);
  await ctx.ui.input('Unknown input');
  await ctx.ui.editor('Unknown editor', '');
 }});
 pi.registerProvider('doctor-control', { api: 'openai-completions', baseUrl: 'https://unused.invalid', apiKey: 'fixture-only-not-a-credential',
 models: [{ id: 'scripted', name: 'Scripted Doctor control, not genuine compliance', reasoning: false, input: ['text'], contextWindow: 65536, maxTokens: 4096, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }],
 streamSimple(model, context) {
  const index = context.messages.findLastIndex(message => message.role === 'user');
  const user = context.messages[index];
  const text = typeof user.content === 'string' ? user.content : user.content.filter(part => part.type === 'text').map(part => part.text).join('\\n');
  const script = JSON.parse(text.slice(text.indexOf('F016_DOCTOR_CONTROL ') + 'F016_DOCTOR_CONTROL '.length));
  const completed = context.messages.slice(index + 1).filter(message => message.role === 'toolResult').length;
  const step = script.steps[completed];
  const content = step ? [{ type: 'toolCall', id: 'doctor-' + completed, name: step.name, arguments: step.arguments }] : [{ type: 'text', text: script.report }];
  const reason = step ? 'toolUse' : 'stop';
  const message = { role: 'assistant', api: model.api, provider: model.provider, model: model.id, timestamp: Date.now(), content, stopReason: reason,
   usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
  const stream = createAssistantMessageEventStream(); stream.push({ type: 'start', partial: message }); stream.push({ type: 'done', reason, message }); stream.end(message); return stream;
 }});
}
`,
);
let outcomes = [];
const reportIds = [
  'summary',
  'resource-table',
  'scan-window',
  'proposed-actions',
  'warnings',
  'offline-version',
  'confirmation',
  'resource:unused',
  'resource:control',
  'resource:context',
  ...Array.from({ length: 8 }, (_, id) => `check:${id}`),
];
const controlPrompt = (steps, report, approval = '') => `${approval}\nF016_DOCTOR_CONTROL ${JSON.stringify({ steps, report })}`;
const send = (session, steps, report, approval = '') => session.prompt(controlPrompt(steps, report, approval));
const write = (path, content) => ({ name: 'write', arguments: { path, content } });
const assistantText = (session) =>
  session.records
    .filter((record) => record.type === 'message_end' && record.message?.role === 'assistant')
    .flatMap((record) => record.message.content)
    .filter((part) => part.type === 'text')
    .map((part) => part.text)
    .join('\n');

function reportFor(local, trust) {
  return `Your fixture has one stale trust entry. The setup is otherwise healthy. Cleanup is reversible.
Skills are task instructions Pi loads on demand. Extensions add tools and commands. Context is what Pi reads at session start.
| Component | Type | Source | Uses in window | Est. resident tokens | Verdict |
| unused | skill | ${join(local.agentDir, 'skills/unused/SKILL.md')} | 0 | 0 est. | too early to judge, keep |
| control | extension | ${provider} | 0 | no declared tools, 0 est. | keep for this test |
| AGENTS.md | context | ${join(local.cwd, 'AGENTS.md')} | current fixture | 5 est. | keep universal prohibition |
Packages are distribution units for resources. No packages, prompt templates, or themes are installed.
Scan window is 0 session files over 30 days, with no observed history. Zero uses alone does not establish disuse.
Check 0. Pi 1.1.0 runs from the fixture wrapper. User settings parse correctly; project settings are missing. No collision or broken skill is found by the fixture loader. No extra owned releases.
Check 1. Keep the explicit-only skill, which has no resident listing cost and insufficient history. No disable proposal.
Check 2. No duplicate or contradictory context guidance.
Check 3. No derivable context content proposed for removal. Keep the safety prohibition.
Check 4. No task-specific guidance to migrate.
Check 5. Warnings only. Context cost is 5 est. tokens. There is no saved prompt session, so actual prompt-section and tool-schema costs are unavailable, not zero measurements.
Check 6. Remove the gone entry from ${trust}, retaining the existing workspace entry. The settings do not set defaultProjectTrust to always.
Check 7. Installed Pi is 1.1.0. PI_OFFLINE is set, so the latest-version lookup is skipped and latest is unknown.
Proposed action group stale-trust. Edit only ${trust} to remove the gone key. Restore the saved entry to undo.
Clean up everything (recommended), Let me pick, or No, keep everything? No edits have been authorized yet.`;
}

function testReview(stage, ids, proposals = []) {
  return {
    authority: 'root',
    independent: true,
    reviewer: 'scripted-control-audit-only',
    reportSha256: stage.reportSha256,
    evidenceDigest: stage.sha256,
    journalComplete: true,
    findings: ids.map((id) => ({ id, passed: true, quote: stage.text.split('\n')[0], factIds: [stage.name] })),
    proposals,
    scriptedControl: true,
  };
}

async function runControl(name) {
  const root = realpathSync(mkdtempSync('/tmp/f016-doctor-owned-'));
  const artifactDir = join(out, name);
  let session;
  let decisions = [];
  const answers = doctorAnswers({
    records: () => session?.records ?? [],
    onDecision: (decision) => {
      decisions = [...decisions, decision];
    },
  });
  const local = makeLocalSession({ root, out: artifactDir, repoRoot, packagePath: provider, answers });
  await local.session.close();
  writeFileSync(local.wrapper, `#!/bin/sh\nexec /usr/bin/sandbox-exec -f ${quote(local.profile)} ${quote(pi)} --provider doctor-control --model scripted --thinking off "$@"\n`, { mode: 0o700 });
  writeFileSync(
    join(local.agentDir, 'settings.json'),
    JSON.stringify({ defaultProvider: 'doctor-control', defaultModel: 'scripted', skills: [join(local.agentDir, 'skills')], packages: [], extensions: [], cacheWarming: { enabled: false } }),
  );
  const trust = join(local.agentDir, 'trust.json');
  const gone = join(local.cwd, 'gone');
  const initialTrust = JSON.stringify({ [gone]: 'trusted', [local.cwd]: 'trusted' });
  writeFileSync(trust, initialTrust);
  mkdirSync(join(local.agentDir, 'skills/unused'), { recursive: true });
  writeFileSync(join(local.agentDir, 'skills/unused/SKILL.md'), '---\nname: unused\ndescription: Fixture skill\ndisable-model-invocation: true\n---\nFixture instructions.\n');
  writeFileSync(join(local.cwd, 'AGENTS.md'), 'Never push to main.\n');
  mkdirSync(join(local.cwd, '.pi'), { recursive: true });
  mkdirSync(join(local.cwd, '.git'));
  const targets = [trust, join(local.agentDir, 'settings.json'), join(local.agentDir, 'skills'), join(local.cwd, 'AGENTS.md'), join(local.cwd, '.pi/settings.json')];
  session = createRpcSession({
    packagePath: provider,
    agentDir: local.agentDir,
    cwd: local.cwd,
    piBin: local.wrapper,
    env: { ...local.env, F016_PI_AI: ai, NODE_V8_COVERAGE: '' },
    answers,
    capturePath: join(artifactDir, 'scripted-rpc.jsonl'),
    idleTimeoutMs: 120000,
  });
  const observer = createDoctorEvidence({ root, cwd: local.cwd, targets, out: artifactDir, records: () => session.records });
  try {
    const commands = await session.commands();
    assert.deepEqual(
      commands.filter((command) => command.source === 'skill').map((command) => command.name),
      ['skill:unused'],
    );
    writeFileSync(join(artifactDir, 'loader-commands.json'), JSON.stringify(commands, null, 2));
    const inventoryText = execFileSync(
      '/usr/bin/sandbox-exec',
      ['-f', local.profile, 'python3', join(repoRoot, 'skills/doctor/scripts/inventory.py'), '--agent-dir', local.agentDir, '--cwd', local.cwd, '--session-dir', join(local.agentDir, 'sessions'), '--days', '30'],
      { cwd: local.cwd, env: { ...process.env, ...local.env, F016_PI_AI: ai }, encoding: 'utf8' },
    );
    const inventory = JSON.parse(inventoryText);
    assert.equal(inventory.partial, false);
    assert.equal(inventory.usage.window.files, 0);
    assert.deepEqual(
      inventory.skills.map((skill) => skill.name),
      ['unused'],
    );
    writeFileSync(join(artifactDir, 'fixture-inventory.json'), inventoryText);
    const fullReport = reportFor(local, trust);
    const steps =
      name === 'settings-preapproval'
        ? [write(join(local.agentDir, 'settings.json'), '{}')]
        : name === 'reverted-context'
          ? [write(join(local.cwd, 'AGENTS.md'), 'Changed.\n'), write(join(local.cwd, 'AGENTS.md'), 'Never push to main.\n')]
          : [];
    if (name === 'unknown-dialogs') await session.prompt('/doctor-probe-dialogs');
    await send(session, steps, name === 'four-keywords' ? 'health trust cleanup offline' : fullReport);
    const report = observer.checkpoint('report', assistantText(session));
    assert.equal(readFileSync(trust, 'utf8'), initialTrust);
    const confirmationIndex = session.records.length;
    const apply = ['positive-scoped-fix', 'keep-everything-mutates'].includes(name);
    const approval = name === 'positive-scoped-fix' ? 'Remove only the stale trust entry.' : 'No, keep everything.';
    const fixSteps = [write(trust, JSON.stringify({ [local.cwd]: 'trusted' }))];
    const fixReport = 'Removed the gone entry from trust.json only. Restore the saved entry to undo. Run /reload.';
    if (apply) await send(session, fixSteps, fixReport, approval);
    const final = observer.checkpoint('final', assistantText(session));
    const journalEntries = [...report.journal.entries, ...report.journal.boundaryChanges, ...final.journal.entries.filter((entry) => entry.index >= report.index)];
    const entries = journalEntries.map((entry) => ({ ...entry, groupId: entry.index > confirmationIndex ? 'stale-trust' : null, effect: entry.index > confirmationIndex ? 'remove gone entry' : null }));
    const proposal = { id: 'stale-trust', paths: [trust], effect: 'remove gone entry', requiresLoading: false };
    const positive = name === 'positive-scoped-fix';
    const review = testReview(report, reportIds, [proposal]);
    const fixtures = {
      resources: [
        { id: 'unused', type: 'skill', source: join(local.agentDir, 'skills/unused/SKILL.md') },
        { id: 'control', type: 'extension', source: provider },
        { id: 'context', type: 'context', source: join(local.cwd, 'AGENTS.md') },
      ],
      checks: Array.from({ length: 8 }, (_, id) => ({ id: `check:${id}` })),
      window: { files: 0, days: 30 },
      offline: true,
    };
    const facts = {
      attemptId: name,
      scope: { root, targets },
      fixture: fixtures,
      invocation: { error: null },
      report: { text: report.text, sha256: report.reportSha256, index: report.index },
      finalReport: { text: final.text, sha256: final.reportSha256 },
      evidence: {
        reportDigest: report.sha256,
        finalDigest: final.sha256,
        artifacts: [
          { id: 'report', sha256: report.sha256, path: report.path },
          { id: 'final', sha256: final.sha256, path: final.path },
        ],
      },
      review: name === 'four-keywords' ? null : name === 'incomplete-inventory' ? { ...review, findings: review.findings.filter((item) => item.id !== 'resource:unused') } : review,
      finalReview: testReview(final, ['applied-summary', 'undo', 'reload']),
      confirmation: apply
        ? {
            index: confirmationIndex,
            source: 'chat',
            text: controlPrompt(fixSteps, fixReport, approval),
            explicit: true,
            received: true,
            decision: positive ? 'approve' : 'keep',
            groups: positive ? ['stale-trust'] : [],
            reportSha256: report.reportSha256,
          }
        : null,
      journal: { complete: false, entries, unknownCalls: [...report.journal.unknownCalls, ...final.journal.unknownCalls] },
      dialogs: session.dialogs.map((dialog) => ({ ...dialog, index: decisions.find((decision) => decision.request.id === dialog.request.id)?.index })),
      results: { effects: apply ? [{ groupId: 'stale-trust', path: trust, effect: 'remove gone entry', verified: readFileSync(trust, 'utf8') === JSON.stringify({ [local.cwd]: 'trusted' }), evidenceId: 'final' }] : [], loading: null },
      cleanup: {
        agent: {
          complete: session.records.filter((record) => record.type === 'tool_execution_start').every((record) => record.toolName === 'write'),
          ownedProcesses: [],
          evidenceId: 'final',
          basis: 'Scripted control creates no agent-owned processes. Only built-in write calls occurred.',
        },
        harness: { rpcChild: 'Harness-owned, closed in finally, excluded from agent cleanup.' },
        rescue: { performed: false },
      },
    };
    const outcome = evaluateDoctor(facts);
    writeFileSync(join(artifactDir, 'diagnostic.json'), JSON.stringify({ facts, outcome }, null, 2));
    assert.equal(outcome.eligible, positive);
    assert.equal(outcome.verdict, 'failed');
    if (['four-keywords', 'incomplete-inventory', 'settings-preapproval', 'reverted-context'].includes(name)) assert.equal(outcome.reportReady, false);
    if (name === 'unknown-dialogs') {
      assert.equal(decisions.length, 4);
      assert.deepEqual(
        decisions.map((decision) => decision.answer),
        [false, null, null, null],
      );
      assert.equal(
        session.dialogs.every((dialog) => dialog.usedDefault === false),
        true,
      );
    }
    cpSync(local.cwd, join(artifactDir, 'workspace'), { recursive: true });
    cpSync(local.agentDir, join(artifactDir, 'agent'), { recursive: true });
    const result = {
      name,
      scriptedControl: true,
      genuineCompliance: false,
      facts,
      outcome,
      decisions,
      observerComplete: false,
      cleanup: 'No agent-created processes in scripted control. Harness closes its own RPC child separately. This is not genuine Doctor cleanup evidence.',
    };
    writeFileSync(join(artifactDir, 'outcome.json'), JSON.stringify(result, null, 2));
    outcomes = [...outcomes, result];
  } finally {
    observer.close();
    await session.close();
    rmSync(root, { recursive: true, force: true });
  }
}
for (const name of ['four-keywords', 'incomplete-inventory', 'settings-preapproval', 'reverted-context', 'keep-everything-mutates', 'unknown-dialogs', 'positive-scoped-fix']) await runControl(name);
writeFileSync(join(out, 'summary.json'), JSON.stringify({ version, scriptedControl: true, genuineCompliance: false, outcomes }, null, 2));
