import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import { makeLocalSession } from '../helpers/resource-workflows-local.mjs';
import { reservePort, seedRecipe } from '../helpers/resource-workflows-recipes.mjs';
import * as evidence from '../helpers/resource-workflows-run-evidence.mjs';
import { evaluateRun } from '../helpers/resource-workflows-run-outcome.mjs';
import { openRunOwnership } from '../helpers/resource-workflows-run-ownership.mjs';
import { createRpcSession } from '../lib/rpc.mjs';

const repoRoot = resolve('.');
const out = resolve(process.argv[2] ?? 'artifacts/verify-pi-customizations/f016-run-runtime/probes');
mkdirSync(out, { recursive: true });
const pi = realpathSync(execFileSync('/bin/sh', ['-c', 'command -v pi'], { encoding: 'utf8' }).trim());
const version = execFileSync(pi, ['--version'], { encoding: 'utf8' }).trim();
assert.equal(version, '1.1.0');
const piAi = realpathSync(join(dirname(dirname(pi)), 'install/releases', version, 'node_modules/@earendil-works/pi-ai/dist/index.js'));
const provider = join(repoRoot, '.pi/skills/verify-pi-customizations/helpers/resource-workflows-control-provider.mjs');
const quote = (value) => `'${value.replaceAll("'", "'\\''")}'`;
const bash = (command) => ({ name: 'bash', arguments: { command } });

async function controlSession(root, artifactDir, port, batch) {
  const local = makeLocalSession({ root, out: artifactDir, repoRoot, localPorts: [port], deferSession: true });
  const providerName = batch ? 'f016-runtime-batch' : 'f016-control';
  writeFileSync(local.wrapper, `#!/bin/sh\nexec /usr/bin/sandbox-exec -f ${quote(local.profile)} ${quote(pi)} --provider ${providerName} --model scripted --thinking off "$@"\n`, { mode: 0o700 });
  writeFileSync(join(local.agentDir, 'settings.json'), JSON.stringify({ defaultProvider: providerName, defaultModel: 'scripted', skills: [], extensions: [], packages: [], cacheWarming: { enabled: false } }));
  const session = createRpcSession({
    packagePath: repoRoot,
    extraExtensions: [batch ? join(repoRoot, '.pi/skills/verify-pi-customizations/scripts/run-runtime-batch-provider.mjs') : provider],
    agentDir: local.agentDir,
    cwd: local.cwd,
    piBin: local.wrapper,
    env: { ...local.env, NODE_V8_COVERAGE: '', F016_PI_AI: piAi },
    capturePath: join(artifactDir, 'rpc.jsonl'),
    idleTimeoutMs: 120000,
  });
  return { ...local, session };
}

function commands(identity) {
  const tmux = `tmux -S ${quote(identity.socket)}`;
  return identity.kind === 'server'
    ? {
        launch: `${quote(process.execPath)} server.mjs > server.log 2>&1 & echo $!; sleep 0.5`,
        interact: `curl --fail --silent --show-error 'http://127.0.0.1:${identity.port}/greet?name=Ada'; sleep 0.5`,
        cleanup: 'kill "$(cat server.pid)"',
      }
    : {
        launch: `${tmux} new-session -d -s f016-run -x 120 -y 40 '/usr/bin/python3 terminal.py'; sleep 0.5`,
        interact: `${tmux} send-keys -t f016-run:0.0 s Enter; sleep 0.5`,
        inspect: `${tmux} capture-pane -p -t f016-run:0.0; sleep 0.5`,
        cleanup: `${tmux} send-keys -t f016-run:0.0 q; sleep 0.5; ${tmux} kill-server 2>/dev/null || true`,
      };
}

function stepsFor(name, identity) {
  const recipe = commands(identity);
  if (name.endsWith('curl-config')) {
    const config = join(dirname(identity.cwd), 'home', '.curlrc');
    return [bash(`printf 'request-target = "/server.mjs"\\noutput = "/dev/null"\\nwrite-out = "Hello Ada\\\\n"\\n' > ${quote(config)}`), bash(recipe.launch), bash(recipe.interact), bash(recipe.cleanup)];
  }
  if (name.endsWith('mutated-source')) return [bash('printf changed > server.mjs; sleep 0.5')];
  if (name.endsWith('after-cleanup')) return [bash(recipe.launch), bash(recipe.cleanup), bash(recipe.interact)];
  if (name.endsWith('prestarted')) return [bash(recipe.launch.replace('echo $!; ', '')), bash(recipe.launch), bash(recipe.interact), bash(recipe.cleanup)];
  if (name.endsWith('source')) return [bash(`cat ${identity.kind === 'server' ? 'server.mjs' : 'terminal.py'}`)];
  if (name.endsWith('marker')) return [bash(`printf '${identity.kind === 'server' ? 'Hello Ada\\n' : 'Settings enabled\\n'}'; printf forged > interaction.txt`)];
  const interaction = name.endsWith('wrong-route')
    ? recipe.interact.replace('/greet?name=Ada', '/server.mjs')
    : name.endsWith('wrong-port')
      ? recipe.interact.replace(String(identity.port), '1')
      : name.endsWith('no-enter')
        ? recipe.interact.replace('s Enter', 's')
        : recipe.interact;
  const inspect = identity.kind === 'tui' && !name.endsWith('no-inspection') ? [bash(recipe.inspect)] : [];
  const steps = [bash(recipe.launch), bash(interaction), ...inspect, bash(recipe.cleanup)];
  return name.endsWith('unrelated-tmux') ? steps.map((step) => bash(step.arguments.command.replaceAll(identity.socket, `${identity.socket}.other`))) : steps;
}

async function probe(name, kind) {
  const root = mkdtempSync('/tmp/f016-run-runtime-');
  const artifactDir = join(out, name);
  let local;
  let ownership;
  let runtime;
  try {
    const port = await reservePort();
    const batch = name.endsWith('batched-intervention');
    local = await controlSession(root, artifactDir, port, batch);
    const socket = join(root, 'terminal.sock');
    seedRecipe(kind, local.cwd, port, socket);
    if (name.endsWith('wrong-response')) writeFileSync(join(local.cwd, 'server.mjs'), readFileSync(join(local.cwd, 'server.mjs'), 'utf8').replace('Hello Ada', 'Wrong Ada'));
    const identity = evidence.runIdentity({ kind, cwd: local.cwd, port, socket });
    ownership = openRunOwnership({ pid: local.session.pid, port: kind === 'server' ? port : null, socket: kind === 'tui' ? socket : null });
    runtime = evidence.openRunRuntime?.({ identity, session: local.session, ownership });
    const recipe = commands(identity);
    const groups =
      kind === 'server'
        ? [[bash(recipe.launch)], [bash(recipe.interact), bash('printf intervention >/dev/null')], [bash(recipe.cleanup)]]
        : [[bash(recipe.launch), bash(`sleep 0.7; ${recipe.interact.replace('s Enter', 's')}`)], [bash(recipe.interact)], [bash(recipe.inspect)], [bash(recipe.cleanup)]];
    const prompt = batch ? `F016_RUNTIME_BATCH ${JSON.stringify(groups)}` : `F016_CONTROL ${JSON.stringify(stepsFor(name, identity))}`;
    await local.session.prompt(prompt);
    await runtime?.finish();
    const cleanup = await ownership.snapshot();
    const facts = evidence.collectRunEvidence({ identity, records: local.session.records, error: null, cleanup, rescue: null, out: artifactDir, mode: 'scripted', runtime });
    const rescue = await ownership.rescue();
    const outcome = evaluateRun({ ...facts, rescue });
    const interaction = !outcome.missing.includes(`${kind} actual correlated interaction`);
    assert.equal(outcome.eligible, false);
    assert.equal(outcome.verdict, 'failed');
    assert.equal(outcome.genuineCompliance, false);
    assert.equal(cleanup.complete, false);
    cpSync(local.cwd, join(artifactDir, 'workspace'), { recursive: true });
    writeFileSync(join(artifactDir, 'outcome.json'), `${JSON.stringify({ facts, outcome, interaction, rescue, scriptedControl: true, genuineCompliance: false }, null, 2)}\n`);
    return { name, kind, interaction, factCount: facts.observations.length, facts: facts.observations, cleanup, outcome };
  } finally {
    await runtime?.close();
    try {
      if (ownership) await ownership.rescue();
    } finally {
      ownership?.close();
      await local?.session.close();
      rmSync(root, { recursive: true, force: true });
    }
  }
}

const cases = [
  ['server-positive', 'server'],
  ['tui-positive', 'tui'],
  ['server-wrong-route', 'server'],
  ['server-curl-config', 'server'],
  ['server-prestarted', 'server'],
  ['server-batched-intervention', 'server'],
  ['server-after-cleanup', 'server'],
  ['server-wrong-port', 'server'],
  ['server-wrong-response', 'server'],
  ['server-source', 'server'],
  ['server-mutated-source', 'server'],
  ['server-marker', 'server'],
  ['tui-source', 'tui'],
  ['tui-marker', 'tui'],
  ['tui-no-enter', 'tui'],
  ['tui-no-inspection', 'tui'],
  ['tui-unrelated-tmux', 'tui'],
  ['tui-batched-intervention', 'tui'],
];
const selected = process.argv.slice(3);
assert.equal(
  selected.every((name) => cases.some(([candidate]) => candidate === name)),
  true,
  'Unknown runtime control.',
);
let results = [];
for (const [name, kind] of cases.filter(([name]) => !selected.length || selected.includes(name))) results = [...results, await probe(name, kind)];
writeFileSync(join(out, 'summary.json'), `${JSON.stringify({ version, scriptedControl: true, genuineCompliance: false, results }, null, 2)}\n`);
for (const result of results) process.stdout.write(`${result.name} interaction=${result.interaction} facts=${result.factCount} verdict=${result.outcome.verdict} complete=${result.cleanup.complete}\n`);
for (const result of results) assert.equal(result.interaction, result.name.endsWith('positive'), `${result.name} actual correlated interaction`);
