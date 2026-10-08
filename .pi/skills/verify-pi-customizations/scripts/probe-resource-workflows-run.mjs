import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import { checkInteraction, makeLocalSession } from '../helpers/resource-workflows-local.mjs';
import { reservePort, seedRecipe } from '../helpers/resource-workflows-recipes.mjs';
import { collectRunEvidence, runIdentity } from '../helpers/resource-workflows-run-evidence.mjs';
import { evaluateRun } from '../helpers/resource-workflows-run-outcome.mjs';
import { openRunOwnership } from '../helpers/resource-workflows-run-ownership.mjs';
import { createRpcSession } from '../lib/rpc.mjs';

const repoRoot = resolve('.');
const out = resolve(process.argv[2] ?? 'artifacts/verify-pi-customizations/f016-run-oracles/probes');
mkdirSync(out, { recursive: true });
const pi = realpathSync(execFileSync('/bin/sh', ['-c', 'command -v pi'], { encoding: 'utf8' }).trim());
const version = execFileSync(pi, ['--version'], { encoding: 'utf8' }).trim();
assert.equal(version, '1.1.0');
const piAi = realpathSync(join(dirname(dirname(pi)), 'install/releases', version, 'node_modules/@earendil-works/pi-ai/dist/index.js'));
const provider = join(repoRoot, '.pi/skills/verify-pi-customizations/helpers/resource-workflows-control-provider.mjs');
const quote = (value) => `'${value.replaceAll("'", "'\\''")}'`;
const bash = (command) => ({ name: 'bash', arguments: { command } });
const libraryCommand = `node --input-type=module -e 'import { greet } from "greeting-kit"; process.stdout.write(greet("Ada") + "\\n");'`;

async function controlSession(root, artifactDir, port) {
  const local = makeLocalSession({ root, out: artifactDir, repoRoot, localPorts: [port] });
  await local.session.close();
  writeFileSync(local.wrapper, `#!/bin/sh\nexec /usr/bin/sandbox-exec -f ${quote(local.profile)} ${quote(pi)} --provider f016-control --model scripted --thinking off "$@"\n`, { mode: 0o700 });
  writeFileSync(join(local.agentDir, 'settings.json'), JSON.stringify({ defaultProvider: 'f016-control', defaultModel: 'scripted', skills: [], extensions: [], packages: [], cacheWarming: { enabled: false } }));
  const session = createRpcSession({
    packagePath: repoRoot,
    extraExtensions: [provider],
    agentDir: local.agentDir,
    cwd: local.cwd,
    piBin: local.wrapper,
    env: { ...local.env, NODE_V8_COVERAGE: '', F016_PI_AI: piAi },
    capturePath: join(artifactDir, 'rpc.jsonl'),
    idleTimeoutMs: 120000,
  });
  return { ...local, session };
}

function stepsFor(name, local, port) {
  if (name === 'cat-source') {
    writeFileSync(join(local.cwd, 'README.md'), 'Source example Hello Ada\n');
    return [bash('cat README.md'), bash(`printf forged > ${quote(join(dirname(local.wrapper), 'protected-run-evidence.json'))}`)];
  }
  if (name === 'broken-package-internal-import') {
    writeFileSync(join(local.cwd, 'package.json'), JSON.stringify({ name: 'greeting-kit', type: 'module', exports: './missing.mjs' }));
    return [bash(libraryCommand.replace('greeting-kit', './greet.mjs'))];
  }
  if (name === 'leave-server') return [bash(`node server.mjs > server.log 2>&1 & sleep 1; curl -sf http://127.0.0.1:${port}/greet?name=Ada`)];
  if (name === 'leave-changing-cwd-helper') return [bash(`node -e 'process.chdir("/");setInterval(()=>{},1000)' > helper.log 2>&1 & sleep 1; printf 'Hello Ada\\n'`)];
  return [bash(name === 'cli-positive' ? './greet hello Ada' : libraryCommand)];
}

async function probe(name, kind) {
  const root = mkdtempSync('/tmp/f016-run-control-');
  const artifactDir = join(out, name);
  const port = await reservePort();
  const local = await controlSession(root, artifactDir, port);
  const ownership = openRunOwnership({ pid: local.session.pid, port: kind === 'server' ? port : null });
  let rescued = null;
  try {
    seedRecipe(kind, local.cwd, port, join(root, 'terminal.sock'));
    const identity = runIdentity({ kind, cwd: local.cwd, port, socket: join(root, 'terminal.sock') });
    await local.session.prompt(`F016_CONTROL ${JSON.stringify(stepsFor(name, local, port))}`);
    const cleanup = await ownership.snapshot();
    rescued = await ownership.rescue();
    const facts = collectRunEvidence({ identity, records: local.session.records, error: null, cleanup, rescue: rescued, out: artifactDir, mode: 'scripted' });
    const outcome = evaluateRun(facts);
    assert.equal(outcome.eligible, false);
    assert.equal(outcome.verdict, 'failed');
    assert.equal(outcome.genuineCompliance, false);
    if (name === 'cat-source')
      assert.equal(
        local.session.records.some((record) => record.type === 'tool_execution_end' && record.isError === true),
        true,
      );
    const legacyAccepted = checkInteraction(local.session.records, 'Hello Ada');
    assert.equal(legacyAccepted, true);
    if (name.endsWith('positive')) assert.equal(facts.observations.length, 1);
    else assert.equal(facts.observations.length, 0);
    if (name.startsWith('leave-')) {
      assert.equal(
        cleanup.resources.some((resource) => resource.alive),
        true,
      );
      assert.equal(rescued.performed, true);
      assert.equal(rescued.confirmed, true);
    }
    cpSync(local.cwd, join(artifactDir, 'workspace'), { recursive: true });
    writeFileSync(join(artifactDir, 'outcome.json'), `${JSON.stringify({ facts, outcome, legacyAccepted, scriptedControl: true, genuineCompliance: false }, null, 2)}\n`);
    return { name, kind, legacyAccepted, outcome, capture: join(artifactDir, 'rpc.jsonl') };
  } finally {
    ownership.close();
    if (!rescued) await ownership.rescue();
    await local.session.close();
    rmSync(root, { recursive: true, force: true });
  }
}

let outcomes = [];
for (const [name, kind] of [
  ['cat-source', 'cli'],
  ['broken-package-internal-import', 'library'],
  ['leave-server', 'server'],
  ['leave-changing-cwd-helper', 'cli'],
  ['cli-positive', 'cli'],
  ['library-positive', 'library'],
]) {
  outcomes = [...outcomes, await probe(name, kind)];
}
writeFileSync(
  join(out, 'summary.json'),
  `${JSON.stringify({ version, scriptedControl: true, genuineCompliance: false, outcomes, gui: { status: 'wrong-surface', proof: 'Pure missing-click controls only. Actual GUI observations await VM prototype.' } }, null, 2)}\n`,
);
process.stdout.write(`${join(out, 'summary.json')}\n`);
