import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, existsSync, writeFileSync, cpSync } from 'node:fs';
import { join } from 'node:path';
import { makeLocalSession, attemptPrompt, checkInteraction } from '../helpers/resource-workflows-local.mjs';
import { seedGreetingCli, seedLibrary, seedSimplify } from '../helpers/resource-workflows-fixtures.mjs';

function assistantText(session) {
  return session.records.filter((record) => record.type === 'message_end' && record.message?.role === 'assistant')
    .flatMap((record) => record.message.content ?? []).filter((part) => part.type === 'text').map((part) => part.text).join('\n');
}

function preserve(cwd, out) {
  cpSync(cwd, join(out, 'workspace'), { recursive: true });
}

export default async function drive(context) {
  const { repoRoot, scratchDir, artifactDir, receipts } = context;
  const rows = readFileSync(join(repoRoot, 'docs/user-perspective-testing/surfaces.tsv'), 'utf8').split('\n');
  const summary = [];
  const expected = (id) => rows.find((row) => row.startsWith(`${id}\t`)).split('\t')[6];
  const finish = (id, status, out) => {
    writeFileSync(join(out, 'attempt.json'), `${JSON.stringify(status, null, 2)}\n`);
    summary.push({ id, ...status });
    receipts.write({ surfaceId: id, package: 'skills', expected: expected(id), observed: JSON.stringify(status), evidence: join(out, 'attempt.json'), verdict: status.verdict, reason: status.reason });
  };
  const launch = (name, packagePath) => {
    const out = join(artifactDir, name);
    const root = join(scratchDir, name);
    return { ...makeLocalSession({ root, out, repoRoot, packagePath }), out };
  };

  const doctor = launch('setup');
  try {
    const trust = join(doctor.agentDir, 'trust.json');
    const stale = join(doctor.cwd, 'gone');
    writeFileSync(trust, JSON.stringify({ [stale]: 'trusted' }));
    const before = readFileSync(trust, 'utf8');
    const firstError = await attemptPrompt(doctor.session, `/skill:doctor Check my Pi setup at ${doctor.agentDir} for the project ${doctor.cwd}. It is offline. Present your complete health report before changing anything.`);
    const report = assistantText(doctor.session);
    const unchanged = readFileSync(trust, 'utf8') === before;
    const reported = report.includes('Component') && report.includes('Clean up everything') && report.includes('Let me pick') && report.includes('No, keep everything');
    writeFileSync(join(doctor.out, 'before-approval.json'), JSON.stringify({ firstError, unchanged, reported, report }, null, 2));
    let approvalError = null;
    if (!firstError && unchanged && reported) approvalError = await attemptPrompt(doctor.session, 'Clean up everything (recommended). Apply the proposed fixes to my fixture setup.');
    const removed = !Object.hasOwn(JSON.parse(readFileSync(trust, 'utf8')), stale);
    cpSync(doctor.agentDir, join(doctor.out, 'agent'), { recursive: true });
    finish('RS-SKILL-1', { verdict: firstError || approvalError || !unchanged || !reported || !removed ? 'failed' : 'inconclusive', firstError, approvalError, unchangedBeforeApproval: unchanged, actualReport: reported, confirmedStaleTrustRemoval: removed, reason: 'Report and trust-file ordering are recorded. Full pre-approval filesystem edits and post-fix inventory verification require transcript audit.' }, doctor.out);
  } finally { await doctor.session.close(); }

  const interactions = [];
  for (const kind of ['cli', 'library']) {
    const app = launch(`greeting-${kind}`);
    try {
      if (kind === 'cli') seedGreetingCli(app.cwd); else seedLibrary(app.cwd);
      const error = await attemptPrompt(app.session, `/skill:run Run my project at ${app.cwd} and try greeting Ada. It is offline and has no dependencies. Do not change its behavior.`);
      const interacted = checkInteraction(app.session.records, 'Hello Ada');
      interactions.push({ kind, error, interacted, capture: join(app.out, 'rpc.jsonl') });
      preserve(app.cwd, app.out);
    } finally { await app.session.close(); }
  }
  const runOut = join(artifactDir, 'run');
  mkdirSync(runOut, { recursive: true });
  finish('RS-SKILL-2', { verdict: 'inconclusive', interactions, reason: 'CLI and library attempts do not prove the full row. Electron, Playwright, server and TUI interaction remain unresolved.' }, runOut);

  const cleanup = launch('greeting-cleanup', join(repoRoot, 'extensions/pi-pstack'));
  try {
    seedSimplify(cleanup.cwd);
    const testsBefore = execFileSync('node', ['--test', 'greeting.test.mjs'], { cwd: cleanup.cwd, encoding: 'utf8' });
    const testSource = readFileSync(join(cleanup.cwd, 'greeting.test.mjs'), 'utf8');
    const before = readFileSync(join(cleanup.cwd, 'greeting.mjs'), 'utf8');
    const error = await attemptPrompt(cleanup.session, `/skill:simplify ${join(cleanup.cwd, 'greeting.mjs')} My project root is ${cleanup.cwd}. Clean up the changed greeting code without changing its behavior. Use the available subagent tool for the independent reviews. Run the existing checks when finished.`);
    let testsAfter;
    try { testsAfter = execFileSync('/usr/bin/sandbox-exec', ['-f', cleanup.profile, 'node', '--test', 'greeting.test.mjs'], { cwd: cleanup.cwd, env: { ...process.env, ...cleanup.env }, encoding: 'utf8', timeout: 10000, maxBuffer: 1048576 }); } catch (failure) { testsAfter = failure.stdout?.toString() ?? failure.message; }
    writeFileSync(join(cleanup.out, 'tests-before.txt'), testsBefore);
    writeFileSync(join(cleanup.out, 'tests-after.txt'), testsAfter);
    const testsUnchanged = readFileSync(join(cleanup.cwd, 'greeting.test.mjs'), 'utf8') === testSource;
    const changed = readFileSync(join(cleanup.cwd, 'greeting.mjs'), 'utf8') !== before;
    preserve(cleanup.cwd, cleanup.out);
    cpSync(cleanup.agentDir, join(cleanup.out, 'agent'), { recursive: true });
    finish('RS-SKILL-3', { verdict: error || !testsUnchanged ? 'failed' : 'inconclusive', error, changed, testsUnchanged, reason: 'A changed file or passing test cannot prove four real concurrent reviewers. Child transcripts and overlap require independent audit.' }, cleanup.out);
  } finally { await cleanup.session.close(); }

  const reverse = launch('greeting-command');
  try {
    const target = seedGreetingCli(reverse.cwd);
    const error = await attemptPrompt(reverse.session, `/skill:reverse-engineer-cli ${target} I own this greeting command. My project root is ${reverse.cwd}. Document help, version, greeting and usage errors. Keep the scope to those behaviors. Produce replayable .re evidence and reports. No external services or downloads.`);
    const re = join(reverse.cwd, '.re');
    const required = ['report/behavior.md', 'report/architecture.md', 'report/evidence.md', 'probes/cases.json', 'repro/run-all', 'target/identity.json', 'source/command-tree.json'];
    const present = required.filter((path) => existsSync(join(re, path)) && readFileSync(join(re, path)).length > 0);
    let replayCode = null;
    let replay = 'Required workspace absent.';
    if (present.length === required.length) {
      const cases = JSON.parse(readFileSync(join(re, 'probes/cases.json'), 'utf8'));
      const reviewed = Array.isArray(cases) && cases.length > 0 && cases.every((item) => item.safe === true && Array.isArray(item.args) && item.args.every((arg) => typeof arg === 'string') && !item.seed && !item.stdin_file);
      if (reviewed) {
        try {
          replay = execFileSync('/usr/bin/sandbox-exec', ['-f', reverse.profile, 'python3', join(repoRoot, 'skills/reverse-engineer-cli/scripts/investigate.py'), 'run', '--workspace', re], { cwd: reverse.cwd, env: { ...process.env, ...reverse.env }, encoding: 'utf8', timeout: 30000 });
          replayCode = 0;
        } catch (failure) { replay = failure.stdout?.toString() + '\n' + failure.stderr?.toString(); replayCode = failure.status; }
      } else replay = 'Corpus was not safe for independent replay.';
    }
    preserve(reverse.cwd, reverse.out);
    writeFileSync(join(reverse.out, 'replay.txt'), replay);
    finish('RS-SKILL-4', { verdict: error || (replayCode !== null && replayCode !== 0) ? 'failed' : 'inconclusive', error, present, replayCode, reason: 'Workspace presence and any actual replay are recorded. Evidence-to-report audit is still required before verification.' }, reverse.out);
    const implementation = launch('greeting-port');
    try {
      if (existsSync(re)) cpSync(re, join(implementation.cwd, '.re'), { recursive: true });
      cpSync(target, join(implementation.cwd, 'reference-greet'));
      const implementationError = await attemptPrompt(implementation.session, `/skill:implement-cli-from-contract Reimplement my greeting command in Python as an installable zipapp named greet.pyz in my project ${implementation.cwd}. The authorized reference is ${join(implementation.cwd, 'reference-greet')}. Use the .re contract here. Preserve help, version, greetings and usage errors. This is offline. Capture immutable reference results before writing implementation. Prove the packaged zipapp with actual differential execution.`);
      preserve(implementation.cwd, implementation.out);
      finish('RS-SKILL-5', { verdict: implementationError ? 'failed' : 'inconclusive', error: implementationError, packagedArtifactPresent: existsSync(join(implementation.cwd, 'greet.pyz')), reason: 'Immutable reference-before-code ordering, actual candidate differential results and packaged artifact execution require independent audit. Model prose is not evidence.' }, implementation.out);
    } finally { await implementation.session.close(); }
  } finally { await reverse.session.close(); }
  writeFileSync(join(artifactDir, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
}
