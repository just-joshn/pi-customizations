import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

delete process.env.NODE_TEST_CONTEXT;
delete process.env.NODE_V8_COVERAGE;
const { default: drive } = await import(process.argv[3] ?? '../scenarios/resource-workflows-local.mjs');

const repoRoot = resolve('.');
const out = resolve(process.argv[2] ?? `artifacts/verify-pi-customizations/f016-simplify-main/${Date.now()}`);
mkdirSync(out, { recursive: true });
const pi = realpathSync(execFileSync('/bin/sh', ['-c', 'command -v pi'], { encoding: 'utf8' }).trim());
assert.equal(execFileSync(pi, ['--version'], { encoding: 'utf8' }).trim(), '1.1.0');
const ai = join(dirname(dirname(pi)), 'install/releases/1.1.0/node_modules/@earendil-works/pi-ai/dist/index.js');
const quote = (value) => `'${value.replaceAll("'", "'\\''")}'`;
const outcomes = [];
const names = ['native-clean', 'lowercase-clean', 'native-diff', 'lowercase-diff', 'parent-write', 'unobserved-shell', 'child-write', 'wrong-parent', 'capability-unreadable', 'forged-observation', 'changed-config', 'source-symlink'];
for (const name of names.filter((name) => !process.argv[4] || name === process.argv[4])) {
  const root = realpathSync(mkdtempSync('/tmp/f016-simplify-main-'));
  const artifactDir = join(out, name);
  mkdirSync(artifactDir, { recursive: true });
  const shimDir = join(root, 'bin');
  mkdirSync(shimDir);
  const provider = join(root, 'provider.mjs');
  const lower = name.startsWith('lowercase') || name === 'child-write' || name === 'wrong-parent';
  const steps = name.endsWith('diff')
    ? [{ name: 'bash', arguments: { command: 'git diff' } }]
    : name === 'parent-write'
      ? [{ name: 'write', arguments: { path: 'greeting.mjs', content: "export const greet = (name) => 'Hello ' + name;\n" } }]
      : name === 'unobserved-shell'
        ? [{ name: 'bash', arguments: { command: 'printf harmless' } }]
        : [];
  if (name === 'capability-unreadable') {
    const program = `const fs = require('node:fs'); for (const target of [3, ${JSON.stringify(join(artifactDir, 'greeting-cleanup/recording-capability'))}]) { try { fs.readFileSync(target); process.exit(2); } catch {} } process.stdout.write('Capability inaccessible');`;
    steps.push({ name: 'bash', arguments: { command: `${quote(process.execPath)} -e ${quote(program)}` } });
  }
  if (name === 'forged-observation') {
    const program = `const socket = require('node:net').connect(${JSON.stringify(join(root, 'greeting-cleanup/simplify.sock'))}); socket.on('connect', () => socket.write(JSON.stringify({ token: 'forged', parentSessionId: 'forged', toolCallId: 'f016-0', command: 'git diff' }) + '\\n')); socket.on('data', data => process.stdout.write(data));`;
    steps.push({ name: 'bash', arguments: { command: `${quote(process.execPath)} -e ${quote(program)}` } }, { name: 'bash', arguments: { command: 'git diff' } });
  }
  if (name === 'changed-config') steps.push({ name: 'write', arguments: { path: '.git/config', content: '[core]\n repositoryformatversion = 0\n' } }, { name: 'bash', arguments: { command: 'git diff' } });
  if (name === 'source-symlink') steps.push({ name: 'bash', arguments: { command: 'ln -s /etc/hosts linked-source' } }, { name: 'bash', arguments: { command: 'git diff' } });
  for (const angle of ['reuse', 'simplification', 'efficiency', 'altitude'])
    steps.push(
      lower
        ? {
            name: 'task',
            arguments: {
              agent_type: 'code-review',
              name: angle,
              description: 'Scripted MAIN integration control',
              prompt: name === 'child-write' ? `F016_CONTROL ${JSON.stringify([{ name: 'write', arguments: { path: `${angle}.mjs`, content: 'Changed by child.\n' } }])}` : `${angle} review F016_HOLD`,
              mode: 'background',
            },
          }
        : { name: 'Task', arguments: { subagent_type: 'generalPurpose', prompt: `${angle} review F016_HOLD`, readonly: true, run_in_background: true } },
    );
  for (let childIndex = 0; childIndex < 4; childIndex++) steps.push({ name: lower ? 'read_agent' : 'TaskOutput', arguments: { childIndex } });
  const original = readFileSync(join(repoRoot, '.pi/skills/verify-pi-customizations/helpers/resource-workflows-control-provider.mjs'), 'utf8');
  writeFileSync(
    provider,
    original
      .replace('const text =', 'let text =')
      .replace(
        'const steps =',
        `text = text.replace(/^<current_datetime>[^]*?<\\/current_datetime>\\s*/, '');\n      if (text.includes('/skill:simplify ')) text = 'F016_CONTROL ' + ${JSON.stringify(JSON.stringify(steps))};\n      const steps =`,
      )
      .replace("message.toolName === 'Task'", "['Task', 'task'].includes(message.toolName)")
      .replace("const args = step?.name === 'TaskOutput' ?", "const args = step?.name === 'read_agent' ? { agent_id: childResults[step.arguments.childIndex]?.details?.agent_id, wait: true, timeout: 30 } : step?.name === 'TaskOutput' ?")
      .replace(
        'export default async function controlProvider(pi) {',
        `export default async function controlProvider(pi) {\n  pi.on('session_start', (_event, ctx) => {\n    if (${JSON.stringify(name)} !== 'wrong-parent' || !ctx.cwd.endsWith('/greeting-cleanup/workspace')) return;\n    pi.on('agent_settled', async () => {\n      const { readFileSync, writeFileSync } = await import('node:fs');\n      const path = ctx.sessionManager.getSessionFile();\n      const lines = readFileSync(path, 'utf8').trim().split('\\n');\n      lines[0] = JSON.stringify({ ...JSON.parse(lines[0]), id: 'wrong-parent' });\n      writeFileSync(path, lines.join('\\n') + '\\n');\n    });\n  });`,
      ),
  );
  const configure = `const fs = require('node:fs'); const path = process.env.PI_CODING_AGENT_DIR + '/settings.json'; const settings = JSON.parse(fs.readFileSync(path)); fs.writeFileSync(path, JSON.stringify({ ...settings, extensions: [${JSON.stringify(provider)}] }));`;
  writeFileSync(join(shimDir, 'pi'), `#!/bin/sh\nexport F016_PI_AI=${quote(ai)}\n${quote(process.execPath)} -e ${quote(configure)}\nexec ${quote(pi)} "$@" -e ${quote(provider)} --provider f016-control --model scripted --thinking off\n`, {
    mode: 0o700,
  });
  const oldPath = process.env.PATH;
  process.env.PATH = `${shimDir}:${oldPath}`;
  try {
    const receipts = [];
    await drive({ repoRoot, scratchDir: root, artifactDir, receipts: { write: (receipt) => receipts.push(receipt) } });
    const status = JSON.parse(readFileSync(join(artifactDir, 'greeting-cleanup/attempt.json'), 'utf8'));
    const expected = ['native-clean', 'lowercase-clean', 'native-diff', 'lowercase-diff'].includes(name);
    outcomes.push({ name, expected, scriptedControl: true, genuineCompliance: false, status });
    writeFileSync(join(out, 'summary.json'), JSON.stringify({ version: '1.1.0', scriptedControl: true, genuineCompliance: false, verdict: 'failed', outcomes }, null, 2));
    console.log(JSON.stringify({ name, eligible: status.eligible, reviewers: status.evidence.reviewers.length, orderingComplete: status.evidence.orderingComplete, missing: status.missing }));
    assert.equal(status.verdict, 'failed', 'Controls never establish genuine compliance');
    assert.equal(status.eligible, expected, `${name} public MAIN eligibility`);
    assert.equal(status.results.testsUnchanged, true);
    assert.equal(status.execution.greeting.stdout, '["Hello Ada","Hello "]\n');
    assert.equal(status.execution.tests.code, 0);
    const records = readFileSync(join(artifactDir, 'greeting-cleanup/rpc.jsonl'), 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    if (name === 'capability-unreadable')
      assert.ok(records.some((record) => record.type === 'tool_execution_end' && record.toolName === 'bash' && record.isError === false && record.result.content.some((part) => part.text === 'Capability inaccessible')));
    if (name === 'forged-observation')
      assert.ok(records.some((record) => record.type === 'tool_execution_end' && record.toolName === 'bash' && record.result.content.some((part) => part.text?.includes('Unauthenticated or unsupported recording operation'))));
    if (process.argv[3]) continue;
    const recording = JSON.parse(readFileSync(join(artifactDir, 'greeting-cleanup/parent-recording.json'), 'utf8'));
    assert.equal(recording.parentToolObservations.length, name.endsWith('diff') || name === 'forged-observation' ? 1 : 0, name);
    for (const observation of recording.parentToolObservations) {
      assert.equal(observation.complete, true);
      assert.equal(observation.sourceEdit, false);
      assert.equal(observation.execution.executable, '/usr/bin/git');
      assert.equal(observation.execution.shell, false);
      assert.equal(observation.execution.code, 0);
      assert.deepEqual(observation.sourceBefore, observation.sourceAfter);
      assert.ok(records.some((record) => record.type === 'tool_execution_end' && record.toolName === 'bash' && record.toolCallId === observation.toolCallId && record.isError === false));
    }
  } finally {
    process.env.PATH = oldPath;
    rmSync(root, { recursive: true, force: true });
  }
}
