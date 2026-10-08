import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import { makeLocalSession } from '../helpers/resource-workflows-local.mjs';
import { collectSimplifyEvidence } from '../helpers/resource-workflows-simplify-evidence.mjs';
import { createRpcSession } from '../lib/rpc.mjs';

const repoRoot = resolve('.');
const out = resolve(process.argv[2] ?? `artifacts/verify-pi-customizations/f016-simplify-collection/${Date.now()}`);
mkdirSync(out, { recursive: true });
const pi = realpathSync(execFileSync('/bin/sh', ['-c', 'command -v pi'], { encoding: 'utf8' }).trim());
assert.equal(execFileSync(pi, ['--version'], { encoding: 'utf8' }).trim(), '1.1.0');
const ai = realpathSync(join(dirname(dirname(pi)), 'install/releases/1.1.0/node_modules/@earendil-works/pi-ai/dist/index.js'));
const quote = (value) => `'${value.replaceAll("'", "'\\''")}'`;
const outcomes = [];

for (const name of ['native-clean', 'native-diff', 'lowercase-clean', 'lowercase-diff', 'parent-write', 'lowercase-child-write', 'native-ls', 'native-unobserved-shell']) {
  const root = realpathSync(mkdtempSync('/tmp/f016-simplify-collection-'));
  const artifactDir = join(out, name);
  const local = makeLocalSession({ root, out: artifactDir, repoRoot, packagePath: join(repoRoot, 'extensions/pi-pstack') });
  await local.session.close();
  const provider = join(root, 'provider.mjs');
  const observationsFile = join(root, 'observations.json');
  writeFileSync(observationsFile, '[]');
  const diffCommand = '/usr/bin/git --no-pager -c core.hooksPath=/dev/null -c diff.external= diff --no-ext-diff --no-textconv HEAD -- source.mjs';
  const original = readFileSync(join(repoRoot, '.pi/skills/verify-pi-customizations/helpers/resource-workflows-control-provider.mjs'), 'utf8');
  writeFileSync(
    provider,
    original
      .replace('const text =', 'let text =')
      .replace(
        'const steps =',
        `text = text.replace(/^<current_datetime>[^]*?<\\/current_datetime>\\s*/, '');
      const steps =`,
      )
      .replace("message.toolName === 'Task'", "['Task', 'task'].includes(message.toolName)")
      .replace("const args = step?.name === 'TaskOutput' ?", "const args = step?.name === 'read_agent' ? { agent_id: childResults[step.arguments.childIndex]?.details?.agent_id, wait: true, timeout: 30 } : step?.name === 'TaskOutput' ?"),
  );
  writeFileSync(local.wrapper, `#!/bin/sh\nexec /usr/bin/sandbox-exec -f ${quote(local.profile)} ${quote(pi)} -e ${quote(provider)} --provider f016-control --model scripted --thinking off "$@"\n`, { mode: 0o700 });
  writeFileSync(join(local.agentDir, 'settings.json'), JSON.stringify({ defaultProvider: 'f016-control', defaultModel: 'scripted', skills: [], extensions: [provider], packages: [], cacheWarming: { enabled: false } }));
  writeFileSync(join(local.cwd, 'source.mjs'), 'export const value = 1;\n');
  for (const angle of ['reuse', 'simplification', 'efficiency', 'altitude']) mkdirSync(join(local.cwd, angle));
  const gitEnv = {
    ...local.env,
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_AUTHOR_NAME: 'Fixture',
    GIT_AUTHOR_EMAIL: 'fixture@example.invalid',
    GIT_COMMITTER_NAME: 'Fixture',
    GIT_COMMITTER_EMAIL: 'fixture@example.invalid',
  };
  for (const args of [
    ['init', '-q'],
    ['add', 'source.mjs'],
    ['-c', 'core.hooksPath=/dev/null', 'commit', '-qm', 'Fixture'],
  ])
    execFileSync('/usr/bin/git', args, { cwd: local.cwd, env: gitEnv });
  const config = readFileSync(join(local.cwd, '.git/config'), 'utf8');
  const baseProvider = join(root, 'base-provider.mjs');
  cpSync(provider, baseProvider);
  writeFileSync(
    provider,
    `import base from './base-provider.mjs';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
export default async function(pi) {
 await base(pi);
 pi.registerTool({ name: 'bash', label: 'Bounded fixture diff', description: 'Fixed argv readonly fixture diff, not a shell', parameters: { type: 'object', properties: { command: { type: 'string' } }, required: ['command'], additionalProperties: false },
 execute: async (id, args) => {
  if (args.command !== ${JSON.stringify(diffCommand)}) throw new Error('Unobserved shell execution denied');
  const configPath = ${JSON.stringify(join(local.cwd, '.git/config'))};
  if (readFileSync(configPath, 'utf8') !== ${JSON.stringify(config)}) throw new Error('Fixture git configuration changed');
  const sourcePath = ${JSON.stringify(join(local.cwd, 'source.mjs'))};
  const before = readFileSync(sourcePath, 'utf8');
  const stdout = execFileSync('/usr/bin/git', ['--no-pager', '-c', 'core.hooksPath=/dev/null', '-c', 'diff.external=', 'diff', '--no-ext-diff', '--no-textconv', 'HEAD', '--', 'source.mjs'], { cwd: ${JSON.stringify(local.cwd)}, env: ${JSON.stringify(gitEnv)}, encoding: 'utf8' });
  if (readFileSync(configPath, 'utf8') !== ${JSON.stringify(config)} || readFileSync(sourcePath, 'utf8') !== before) throw new Error('Fixture changed during diff');
  const path = ${JSON.stringify(observationsFile)};
  const observations = JSON.parse(readFileSync(path, 'utf8'));
  writeFileSync(path, JSON.stringify([...observations, { toolCallId: id, complete: true, sourceEdit: false }]));
  return { content: [{ type: 'text', text: stdout || 'Empty fixture diff' }] };
 }});
}
`,
  );
  const session = createRpcSession({
    packagePath: join(repoRoot, 'extensions/pi-pstack'),
    agentDir: local.agentDir,
    cwd: local.cwd,
    piBin: local.wrapper,
    persistSession: true,
    env: { ...local.env, F016_PI_AI: ai, NODE_V8_COVERAGE: '' },
    capturePath: join(artifactDir, 'rpc.jsonl'),
    idleTimeoutMs: 120000,
  });
  try {
    const state = await session.state();
    const lower = name.startsWith('lowercase');
    const steps = name.endsWith('diff')
      ? [{ name: 'bash', arguments: { command: diffCommand } }]
      : name === 'parent-write'
        ? [{ name: 'write', arguments: { path: 'source.mjs', content: 'export const value = 2;\n' } }]
        : name === 'native-unobserved-shell'
          ? [{ name: 'bash', arguments: { command: 'printf unsafe' } }]
          : [];
    for (const angle of ['reuse', 'simplification', 'efficiency', 'altitude'])
      steps.push(
        lower
          ? {
              name: 'task',
              arguments: {
                agent_type: 'code-review',
                name: angle,
                description: 'Scripted collection control',
                prompt: name === 'lowercase-child-write' ? `F016_CONTROL ${JSON.stringify([{ name: 'write', arguments: { path: `${angle}.mjs`, content: 'Changed by child.\\n' } }])}` : `${angle} review F016_HOLD`,
                mode: 'background',
              },
            }
          : {
              name: 'Task',
              arguments: {
                subagent_type: 'generalPurpose',
                prompt: name === 'native-ls' ? `F016_CONTROL ${JSON.stringify([{ name: 'ls', arguments: { path: angle } }])}` : `${angle} review F016_HOLD`,
                readonly: true,
                run_in_background: true,
              },
            },
      );
    for (let childIndex = 0; childIndex < 4; childIndex++) steps.push({ name: lower ? 'read_agent' : 'TaskOutput', arguments: { childIndex } });
    await session.prompt(`F016_CONTROL ${JSON.stringify(steps)}`);
    const parentToolObservations = JSON.parse(readFileSync(observationsFile, 'utf8'));
    const evidence = collectSimplifyEvidence({ records: session.records, root, cwd: local.cwd, parentSessionId: state.sessionId, parentSessionFile: state.sessionFile, parentToolObservations, out: artifactDir });
    if (name.endsWith('diff')) {
      for (const observations of [[], [...parentToolObservations, ...parentToolObservations], parentToolObservations.map((item) => ({ ...item, complete: false })), parentToolObservations.map((item) => ({ ...item, sourceEdit: true }))]) {
        const rejected = collectSimplifyEvidence({ records: session.records, root, cwd: local.cwd, parentSessionId: state.sessionId, parentSessionFile: state.sessionFile, parentToolObservations: observations, out: artifactDir });
        assert.equal(rejected.orderingComplete, false, 'missing, duplicated, incomplete or edit observations fail closed');
      }
    }
    if (lower) {
      const rejected = collectSimplifyEvidence({ records: session.records, root, cwd: local.cwd, parentSessionId: 'wrong-parent', parentSessionFile: state.sessionFile, out: artifactDir });
      assert.equal(rejected.reviewers.length, 0, 'wrong parent cannot own lowercase reviews');
    }
    const result = { name, scriptedControl: true, genuineCompliance: false, verdict: 'failed', state, parentToolObservations, evidence, source: readFileSync(join(local.cwd, 'source.mjs'), 'utf8') };
    writeFileSync(join(artifactDir, 'diagnostic.json'), JSON.stringify(result, null, 2));
    cpSync(local.agentDir, join(artifactDir, 'agent'), { recursive: true });
    cpSync(local.cwd, join(artifactDir, 'workspace'), { recursive: true });
    cpSync(provider, join(artifactDir, 'bounded-provider.mjs'));
    cpSync(baseProvider, join(artifactDir, 'base-provider.mjs'));
    outcomes.push(result);
    console.log(JSON.stringify({ name, reviewers: evidence.reviewers.length, orderingComplete: evidence.orderingComplete }));
  } finally {
    await session.close();
    rmSync(root, { recursive: true, force: true });
  }
}
writeFileSync(join(out, 'summary.json'), JSON.stringify({ version: '1.1.0', scriptedControl: true, genuineCompliance: false, verdict: 'failed', outcomes }, null, 2));
for (const result of outcomes) {
  assert.equal(result.evidence.reviewers.length, 4, `${result.name} has four owned reviews`);
  assert.deepEqual(result.evidence.reviewers.map((item) => item.angle).sort(), ['altitude', 'efficiency', 'reuse', 'simplification'], `${result.name} assigns every source angle`);
  assert.equal(result.evidence.orderingComplete, !['parent-write', 'native-unobserved-shell'].includes(result.name), `${result.name} source edit ordering`);
  assert.equal(
    result.evidence.reviewers.every((item) => item.readonly),
    result.name !== 'lowercase-child-write',
    `${result.name} observed readonly`,
  );
  assert.equal(
    result.evidence.reviewers.every((item) => item.successful),
    true,
    `${result.name} successful findings`,
  );
  assert.equal(result.source, result.name === 'parent-write' ? 'export const value = 2;\n' : 'export const value = 1;\n', `${result.name} source contents`);
  if (!['native-ls', 'lowercase-child-write'].includes(result.name))
    assert.ok(Math.max(...result.evidence.reviewers.map((item) => item.startedAt)) < Math.min(...result.evidence.reviewers.map((item) => item.endedAt)), `${result.name} actual review overlap`);
}
