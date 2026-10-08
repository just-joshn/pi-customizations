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
const quote = value => `'${value.replaceAll("'", "'\\''")}'`;
const outcomes = [];

for (const name of ['native-clean', 'native-diff', 'lowercase-clean', 'lowercase-diff', 'parent-write']) {
  const root = realpathSync(mkdtempSync('/tmp/f016-simplify-collection-'));
  const artifactDir = join(out, name);
  const local = makeLocalSession({ root, out: artifactDir, repoRoot, packagePath: join(repoRoot, 'extensions/pi-pstack') });
  await local.session.close();
  const provider = join(root, 'provider.mjs');
  const original = readFileSync(join(repoRoot, '.pi/skills/verify-pi-customizations/helpers/resource-workflows-control-provider.mjs'), 'utf8');
  writeFileSync(provider, original.replace("message.toolName === 'Task'", "['Task', 'task'].includes(message.toolName)").replace("const args = step?.name === 'TaskOutput' ?", "const args = step?.name === 'read_agent' ? { agent_id: childResults[step.arguments.childIndex]?.details?.agent_id, wait: true, timeout: 30 } : step?.name === 'TaskOutput' ?"));
  writeFileSync(local.wrapper, `#!/bin/sh\nexec /usr/bin/sandbox-exec -f ${quote(local.profile)} ${quote(pi)} -e ${quote(provider)} --provider f016-control --model scripted --thinking off "$@"\n`, { mode: 0o700 });
  writeFileSync(join(local.agentDir, 'settings.json'), JSON.stringify({ defaultProvider: 'f016-control', defaultModel: 'scripted', skills: [], extensions: [provider], packages: [], cacheWarming: { enabled: false } }));
  writeFileSync(join(local.cwd, 'source.mjs'), 'export const value = 1;\n');
  const gitEnv = { ...process.env, ...local.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_AUTHOR_NAME: 'Fixture', GIT_AUTHOR_EMAIL: 'fixture@example.invalid', GIT_COMMITTER_NAME: 'Fixture', GIT_COMMITTER_EMAIL: 'fixture@example.invalid' };
  for (const args of [['init', '-q'], ['add', 'source.mjs'], ['-c', 'core.hooksPath=/dev/null', 'commit', '-qm', 'Fixture']]) execFileSync('/usr/bin/git', args, { cwd: local.cwd, env: gitEnv });
  const session = createRpcSession({ packagePath: join(repoRoot, 'extensions/pi-pstack'), agentDir: local.agentDir, cwd: local.cwd, piBin: local.wrapper, persistSession: true, env: { ...local.env, F016_PI_AI: ai, NODE_V8_COVERAGE: '' }, capturePath: join(artifactDir, 'rpc.jsonl'), idleTimeoutMs: 120000 });
  try {
    const state = await session.state();
    const lower = name.startsWith('lowercase');
    const steps = name.endsWith('diff') ? [{ name: 'bash', arguments: { command: '/usr/bin/git --no-pager -c core.hooksPath=/dev/null -c diff.external= diff --no-ext-diff --no-textconv HEAD -- source.mjs' } }] : name === 'parent-write' ? [{ name: 'write', arguments: { path: 'source.mjs', content: 'export const value = 2;\n' } }] : [];
    for (const angle of ['reuse', 'simplification', 'efficiency', 'altitude']) steps.push(lower ? { name: 'task', arguments: { agent_type: 'code-review', name: angle, description: 'Scripted collection control', prompt: `${angle} review F016_HOLD`, mode: 'background' } } : { name: 'Task', arguments: { subagent_type: 'generalPurpose', prompt: `${angle} review F016_HOLD`, readonly: true, run_in_background: true } });
    for (let childIndex = 0; childIndex < 4; childIndex++) steps.push({ name: lower ? 'read_agent' : 'TaskOutput', arguments: { childIndex } });
    await session.prompt(`F016_CONTROL ${JSON.stringify(steps)}`);
    const evidence = collectSimplifyEvidence({ records: session.records, root, cwd: local.cwd, parentSessionId: state.sessionId, out: artifactDir });
    const result = { name, scriptedControl: true, genuineCompliance: false, state, evidence, source: readFileSync(join(local.cwd, 'source.mjs'), 'utf8') };
    writeFileSync(join(artifactDir, 'diagnostic.json'), JSON.stringify(result, null, 2));
    cpSync(local.agentDir, join(artifactDir, 'agent'), { recursive: true });
    outcomes.push(result);
    console.log(JSON.stringify({ name, reviewers: evidence.reviewers.length, orderingComplete: evidence.orderingComplete }));
  } finally {
    await session.close();
    rmSync(root, { recursive: true, force: true });
  }
}
writeFileSync(join(out, 'summary.json'), JSON.stringify({ version: '1.1.0', scriptedControl: true, genuineCompliance: false, outcomes }, null, 2));
for (const result of outcomes) {
  assert.equal(result.evidence.reviewers.length, 4, `${result.name} has four owned reviews`);
  assert.equal(result.evidence.orderingComplete, result.name !== 'parent-write', `${result.name} source edit ordering`);
}

