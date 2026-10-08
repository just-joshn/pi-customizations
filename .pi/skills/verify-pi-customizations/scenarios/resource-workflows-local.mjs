import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { doctorAnswers } from '../helpers/resource-workflows-doctor-evidence.mjs';
import { driveDoctorReport } from '../helpers/resource-workflows-doctor-phase.mjs';
import { seedGreetingCli, seedLibrary, seedSimplify } from '../helpers/resource-workflows-fixtures.mjs';
import { attemptPrompt, checkInteraction, makeLocalSession } from '../helpers/resource-workflows-local.mjs';
import { collectSimplifyEvidence } from '../helpers/resource-workflows-simplify-evidence.mjs';
import { evaluateSimplify } from '../helpers/resource-workflows-simplify-outcome.mjs';
import { recordSimplifySession } from '../helpers/resource-workflows-simplify-recording.mjs';
import { collectReEvidence, freezeReTarget } from '../helpers/resource-workflows-re-evidence.mjs';
import { evaluateRe } from '../helpers/resource-workflows-re-outcome.mjs';
import { surfaceContract } from '../helpers/resource-workflows-surfaces.mjs';

function preserve(cwd, out) {
  cpSync(cwd, join(out, 'workspace'), { recursive: true });
}

export function writeOutcomeReceipt({ repoRoot, receipts }, outcome) {
  const { expected } = surfaceContract(readFileSync(join(repoRoot, 'docs/user-perspective-testing/surfaces.tsv'), 'utf8'), outcome.surfaceId);
  return receipts.write({ ...outcome, expected });
}

export default async function drive(context) {
  const { repoRoot, scratchDir, artifactDir, receipts } = context;
  const summary = [];
  const finish = (id, status, out) => {
    writeFileSync(join(out, 'attempt.json'), `${JSON.stringify(status, null, 2)}\n`);
    summary.push({ id, ...status });
    writeOutcomeReceipt({ repoRoot, receipts }, { surfaceId: id, package: 'skills', observed: JSON.stringify(status), evidence: join(out, 'attempt.json'), verdict: status.verdict, reason: status.reason });
  };
  const launch = (name, packagePath, answers) => {
    const out = join(artifactDir, name);
    const root = join(scratchDir, name);
    return { ...makeLocalSession({ root, out, repoRoot, packagePath, answers }), out };
  };

  let doctor;
  const doctorDecisions = [];
  const answers = doctorAnswers({ records: () => doctor?.session?.records ?? [], onDecision: (decision) => doctorDecisions.push(decision) });
  doctor = { ...makeLocalSession({ root: join(scratchDir, 'setup'), out: join(artifactDir, 'setup'), repoRoot, answers, deferSession: true }), out: join(artifactDir, 'setup') };
  try {
    const doctorStatus = await driveDoctorReport({ doctor, repoRoot, root: join(scratchDir, 'setup'), reviewReport: context.doctorReviewReport, reviewFinal: context.doctorReviewFinal });
    finish('RS-SKILL-1', { ...doctorStatus, doctorDecisions }, doctor.out);
  } finally {
    await doctor.session?.close();
  }

  const interactions = [];
  for (const kind of ['cli', 'library']) {
    const app = launch(`greeting-${kind}`);
    try {
      if (kind === 'cli') seedGreetingCli(app.cwd);
      else seedLibrary(app.cwd);
      const error = await attemptPrompt(app.session, `/skill:run Run my project at ${app.cwd} and try greeting Ada. It is offline and has no dependencies. Do not change its behavior.`);
      const interacted = checkInteraction(app.session.records, 'Hello Ada');
      interactions.push({ kind, error, interacted, capture: join(app.out, 'rpc.jsonl') });
      preserve(app.cwd, app.out);
    } finally {
      await app.session.close();
    }
  }
  const runOut = join(artifactDir, 'run');
  mkdirSync(runOut, { recursive: true });
  finish('RS-SKILL-2', { verdict: 'inconclusive', interactions, reason: 'CLI and library attempts do not prove the full row. Electron, Playwright, server and TUI interaction remain unresolved.' }, runOut);

  const cleanup = launch('greeting-cleanup', join(repoRoot, 'extensions/pi-pstack'));
  let recording;
  try {
    seedSimplify(cleanup.cwd);
    const testsBefore = execFileSync('node', ['--test', 'greeting.test.mjs'], { cwd: cleanup.cwd, encoding: 'utf8' });
    const testSource = readFileSync(join(cleanup.cwd, 'greeting.test.mjs'), 'utf8');
    const before = readFileSync(join(cleanup.cwd, 'greeting.mjs'), 'utf8');
    recording = await recordSimplifySession({ cleanup, root: join(scratchDir, 'greeting-cleanup'), packagePath: join(repoRoot, 'extensions/pi-pstack') });
    const { sessionId: parentSessionId, sessionFile: parentSessionFile } = recording.state;
    const error = await attemptPrompt(
      recording.session,
      `/skill:simplify ${join(cleanup.cwd, 'greeting.mjs')} My project root is ${cleanup.cwd}. Clean up the changed greeting code without changing its behavior. Use the available subagent tool for the independent reviews. Run the existing checks when finished.`,
    );
    const observe = (args) => {
      const result = spawnSync('/usr/bin/sandbox-exec', ['-f', cleanup.profile, 'node', ...args], { cwd: cleanup.cwd, env: { ...process.env, ...cleanup.env }, encoding: 'utf8', timeout: 10000, maxBuffer: 1048576 });
      return { code: result.status, signal: result.signal, error: result.error?.message ?? null, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
    };
    const testsAfter = observe(['--test', 'greeting.test.mjs']);
    const greetingProgram = ['import { greet } from "./greeting.mjs";', 'const results = [greet("Ada"), greet("")];', 'process.stdout.write(JSON.stringify(results) + "\\n");'].join('\n');
    const greeting = observe(['--input-type=module', '-e', greetingProgram]);
    writeFileSync(join(cleanup.out, 'tests-before.txt'), testsBefore);
    writeFileSync(join(cleanup.out, 'tests-after.txt'), testsAfter.stdout);
    writeFileSync(join(cleanup.out, 'execution.json'), JSON.stringify({ tests: testsAfter, greeting }, null, 2));
    const testsUnchanged = readFileSync(join(cleanup.cwd, 'greeting.test.mjs'), 'utf8') === testSource;
    const changed = readFileSync(join(cleanup.cwd, 'greeting.mjs'), 'utf8') !== before;
    preserve(cleanup.cwd, cleanup.out);
    cpSync(cleanup.agentDir, join(cleanup.out, 'agent'), { recursive: true });
    const parentToolObservations = recording.observations();
    writeFileSync(join(cleanup.out, 'parent-recording.json'), JSON.stringify({ parentSessionId, parentSessionFile, parentToolObservations }, null, 2));
    const facts = {
      invocation: { error },
      execution: { tests: testsAfter, greeting },
      evidence: collectSimplifyEvidence({ records: recording.session.records, root: join(scratchDir, 'greeting-cleanup'), cwd: cleanup.cwd, parentSessionId, parentSessionFile, parentToolObservations, out: cleanup.out }),
      results: { testsUnchanged, changed },
      rescue: { performed: false },
    };
    finish('RS-SKILL-3', { ...facts, ...evaluateSimplify(facts) }, cleanup.out);
  } finally {
    if (recording) await recording.close();
    else await cleanup.session.close();
  }

  const reverse = launch('greeting-command');
  try {
    const target = seedGreetingCli(reverse.cwd);
    const frozen = freezeReTarget({ target, env: reverse.env, attemptId: 'greeting-command' });
    const error = await attemptPrompt(
      reverse.session,
      `/skill:reverse-engineer-cli ${target} I own this greeting command. My project root is ${reverse.cwd}. Document help, version, greeting and usage errors. Keep the scope to those behaviors. Produce replayable .re evidence and reports. No external services or downloads.`,
    );
    const re = join(reverse.cwd, '.re');
    const evidence = collectReEvidence({ frozen, cwd: reverse.cwd, out: reverse.out, profile: reverse.profile, env: reverse.env, repoRoot });
    const facts = { invocation: { error }, origin: 'genuine', evidence };
    preserve(reverse.cwd, reverse.out);
    finish('RS-SKILL-4', { ...facts, ...evaluateRe(facts) }, reverse.out);
    const implementation = launch('greeting-port');
    try {
      if (existsSync(re)) cpSync(re, join(implementation.cwd, '.re'), { recursive: true });
      cpSync(target, join(implementation.cwd, 'reference-greet'));
      const implementationError = await attemptPrompt(
        implementation.session,
        `/skill:implement-cli-from-contract Reimplement my greeting command in Python as an installable zipapp named greet.pyz in my project ${implementation.cwd}. The authorized reference is ${join(implementation.cwd, 'reference-greet')}. Use the .re contract here. Preserve help, version, greetings and usage errors. This is offline. Capture immutable reference results before writing implementation. Prove the packaged zipapp with actual differential execution.`,
      );
      preserve(implementation.cwd, implementation.out);
      finish(
        'RS-SKILL-5',
        {
          verdict: implementationError ? 'failed' : 'inconclusive',
          error: implementationError,
          packagedArtifactPresent: existsSync(join(implementation.cwd, 'greet.pyz')),
          reason: 'Immutable reference-before-code ordering, actual candidate differential results and packaged artifact execution require independent audit. Model prose is not evidence.',
        },
        implementation.out,
      );
    } finally {
      await implementation.session.close();
    }
  } finally {
    await reverse.session.close();
  }
  writeFileSync(join(artifactDir, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
}
