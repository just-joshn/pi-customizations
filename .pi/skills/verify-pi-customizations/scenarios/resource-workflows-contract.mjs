import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { captureReference, comparePackaged, GREETING_CASES } from '../helpers/resource-workflows-contract.mjs';
import { seedGreetingCli } from '../helpers/resource-workflows-fixtures.mjs';
import { attemptPrompt, makeLocalSession } from '../helpers/resource-workflows-local.mjs';

export default async function drive({ repoRoot, artifactDir, receipts }) {
  const root = mkdtempSync('/tmp/rw-');
  const fixture = makeLocalSession({ root, out: artifactDir, repoRoot });
  try {
    const target = seedGreetingCli(fixture.cwd);
    const env = { ...process.env, ...fixture.env, PI_CODING_AGENT_DIR: fixture.agentDir };
    const reference = captureReference({ target, cwd: fixture.cwd, env, out: join(artifactDir, 'reference') });
    writeFileSync(join(artifactDir, 'reference-captured.json'), JSON.stringify({ capturedBeforeInvocation: true, candidateAbsent: !existsSync(join(fixture.cwd, 'greet.pyz')), ...reference }, null, 2));
    const re = join(fixture.cwd, '.re');
    execFileSync('/usr/bin/sandbox-exec', ['-f', fixture.profile, 'python3', join(repoRoot, 'skills/reverse-engineer-cli/scripts/investigate.py'), 'init', '--workspace', re, '--target', target], { cwd: fixture.cwd, env, encoding: 'utf8' });
    const compat = join(re, 'impl/greeting/compat');
    mkdirSync(compat, { recursive: true });
    cpSync(reference.directory, join(compat, 'reference', reference.sha), { recursive: true });
    writeFileSync(
      join(compat, 'cases.json'),
      JSON.stringify(
        GREETING_CASES.map((item) => ({ id: item.id, label: item.id, args: item.args, probe: ['--isolate', '--clean-env'] })),
        null,
        2,
      ),
    );
    const table = GREETING_CASES.map((item) => `| ${item.id} | ${JSON.stringify(item.args)} | ${item.code} | ${JSON.stringify(item.stdout)} | ${JSON.stringify(item.stderr)} |`).join('\n');
    writeFileSync(
      join(re, 'report/behavior.md'),
      `# Greeting command contract\n\nThe fixture author captured actual process outputs before any replacement implementation.\nReference SHA-256 ${reference.sha}. All listed behavior is OBSERVED.\n\n| Case | Args | Exit | Stdout | Stderr |\n|---|---|---|---|---|\n${table}\n\nNo file, network or child effects are part of this command. TTY, signals and config are outside this requested replacement scope. Raw immutable observations are in impl/greeting/compat/reference/${reference.sha}.\n`,
    );
    writeFileSync(
      join(re, 'report/evidence.md'),
      `# Observed fixture corpus\nReference is the owned greet Python command. The identity initializer produced target hashes. The fixture author ran every case in the behavior table through actual subprocesses before replacement code existed. Raw byte records are under impl/greeting/compat/reference/${reference.sha}. No implementation inference is required for the requested exact stream and status compatibility.\n`,
    );
    writeFileSync(
      join(re, 'report/architecture.md'),
      '# Reference architecture\nThe owned command uses Python sys.argv and print. This source structure is not a replacement architecture requirement. No configuration or external adapters exist.\n',
    );
    writeFileSync(
      join(re, 'probes/cases.json'),
      JSON.stringify(
        GREETING_CASES.map((item) => ({ id: item.id, question: `What does ${item.id} produce?`, safe: true, args: item.args, expect: { exit_code: item.code } })),
        null,
        2,
      ),
    );
    const invocation = `/skill:implement-cli-from-contract Reimplement my owned greet command as a Python zipapp greet.pyz. My project root is ${fixture.cwd}, not the skill installation directory. The reference executable is ${target}. Use the captured contract at ${re} and its six-case compatibility corpus. Keep all output bytes and exit statuses exact. The immutable reference results are already captured before implementation. Use the actual differential driver, execute the packaged zipapp, and leave a machine-readable compatibility report. No downloads or external services.`;
    const error = await attemptPrompt(fixture.session, invocation);
    const artifact = join(fixture.cwd, 'greet.pyz');
    const comparison = existsSync(artifact) ? comparePackaged({ artifact, reference, cwd: fixture.cwd, env, profile: fixture.profile }) : null;
    cpSync(fixture.cwd, join(artifactDir, 'workspace'), { recursive: true });
    const toolCalls = fixture.session.records
      .filter((record) => record.type === 'message_end' && record.message?.role === 'assistant')
      .flatMap((record) => record.message.content ?? [])
      .filter((part) => part.type === 'toolCall');
    const differentialRequested = toolCalls.some((call) => call.name === 'bash' && call.arguments?.command?.includes('differential.py'));
    const result = { error, referenceSha256: reference.sha, referenceCapturedBeforeInvocation: true, packagedArtifactPresent: existsSync(artifact), comparison, differentialRequested };
    writeFileSync(join(artifactDir, 'comparison.json'), JSON.stringify(result, null, 2));
    const expected = readFileSync(join(repoRoot, 'docs/user-perspective-testing/surfaces.tsv'), 'utf8')
      .split('\n')
      .find((line) => line.startsWith('RS-SKILL-5\t'))
      .split('\t')[6];
    receipts.write({
      surfaceId: 'RS-SKILL-5',
      package: 'skills',
      expected,
      observed: JSON.stringify(result),
      evidence: join(artifactDir, 'comparison.json'),
      verdict: error || (comparison && !comparison.allMatched) ? 'failed' : 'inconclusive',
      reason: 'The external immutable corpus and packaged candidate comparison are real. The model-produced differential run and compatibility report still require transcript and artifact audit before verification.',
    });
  } finally {
    await fixture.session.close();
    rmSync(root, { recursive: true, force: true });
  }
}
