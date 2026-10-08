import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import { seedGreetingCli } from '../helpers/resource-workflows-fixtures.mjs';
import { makeLocalSession } from '../helpers/resource-workflows-local.mjs';
import { collectReEvidence, freezeReTarget } from '../helpers/resource-workflows-re-evidence.mjs';
import { evaluateRe } from '../helpers/resource-workflows-re-outcome.mjs';
import { createRpcSession } from '../lib/rpc.mjs';

const repoRoot = resolve('.');
const out = resolve(process.argv[2] ?? 'artifacts/verify-pi-customizations/f016-re-bounded/controls');
mkdirSync(out, { recursive: true });
const pi = realpathSync(execFileSync('/bin/sh', ['-c', 'command -v pi'], { encoding: 'utf8' }).trim());
const version = execFileSync(pi, ['--version'], { encoding: 'utf8' }).trim();
assert.equal(version, '1.1.0');
const ai = realpathSync(join(dirname(dirname(pi)), 'install/releases', version, 'node_modules/@earendil-works/pi-ai/dist/index.js'));
const provider = join(repoRoot, '.pi/skills/verify-pi-customizations/helpers/resource-workflows-control-provider.mjs');
const quote = (value) => `'${value.replaceAll("'", "'\\''")}'`;
const sha = (value) => createHash('sha256').update(value).digest('hex');
const contracts = [
  { args: ['--help'], stdout: 'Usage: greet hello NAME\n', stderr: '', code: 0 },
  { args: ['--version'], stdout: 'greet 1.0.0\n', stderr: '', code: 0 },
  { args: ['hello', 'Ada'], stdout: 'Hello Ada\n', stderr: '', code: 0 },
  { args: [], stdout: '', stderr: 'Usage: greet hello NAME\n', code: 2 },
];
const write = (path, content) => ({ name: 'write', arguments: { path, content } });
const bash = (command) => ({ name: 'bash', arguments: { command, timeout: 30 } });

function reportsCommand(re, target, spam) {
  const script = `import json, pathlib, os, hashlib
root = pathlib.Path(${JSON.stringify(re)})
target = pathlib.Path(${JSON.stringify(target)})
cases = json.loads((root / 'probes/cases.json').read_text())
records = [json.loads(line) for line in (root / 'probes/results.jsonl').read_text().splitlines()]
blocks = []
for record in records:
    args = json.dumps(record['argv'][1:], separators=(',', ':'))
    stdout = os.path.relpath(record['stdout']['path'], root / 'report')
    stderr = os.path.relpath(record['stderr']['path'], root / 'report')
    blocks.append(f"Probe: {record['id']}. Scope argv {args}. Exit {record['exit_code']}.\\n[stdout]({stdout}) [stderr]({stderr})")
for name in ['behavior', 'evidence']:
    text = '# ' + name + '\\n\\n' + '\\n\\n'.join(blocks) + '\\n\\nNetwork and platform variants excluded. Process tracing remains UNKNOWN.\\n'
    (root / 'report' / (name + '.md')).write_text(text)
(root / 'report/architecture.md').write_text('# Architecture\\n\\n[entrypoint](' + str(target) + ') is an executable Python script. sys.argv selects help, version, hello or usage failure. Parsing and output belong to this source. Runtime internals and alternate platforms remain uninvestigated.\\n')
(root / 'source/entrypoints.json').write_text(json.dumps([{'path': str(target), 'sha256': hashlib.sha256(target.read_bytes()).hexdigest()}]))
ids = {tuple(case['args']): case['id'] for case in cases}
tree = {'command': 'greet', 'arguments': [], 'options': [{'long': flag, 'evidence': [ids.get((flag,))]} for flag in ['--help', '--version']], 'evidence': [ids.get(())], 'subcommands': [{'command': 'hello', 'arguments': [{'name': 'NAME'}], 'options': [], 'subcommands': [], 'evidence': [ids.get(('hello', 'Ada'))]}]}
(root / 'source/command-tree.json').write_text(json.dumps(tree))
`;
  if (spam)
    return bash(
      `python3 - <<'PY'\nimport pathlib\nroot=pathlib.Path(${JSON.stringify(re)})\nfor name in ['behavior','architecture','evidence']:\n    (root/'report'/(name+'.md')).write_text('# Report\\n\\nStatus: NOT INVESTIGATED\\n' + 'help version greeting usage\\n'*100)\nPY`,
    );
  return bash(`python3 - <<'PY'\n${script}PY`);
}

function legacyBlock(local) {
  const source = readFileSync(join(repoRoot, '.pi/skills/verify-pi-customizations/scenarios/resource-workflows-local.mjs'), 'utf8');
  const start = source.indexOf('    const re = join(reverse.cwd');
  const end = source.indexOf('    const implementation = launch', start);
  assert.ok(start >= 0 && end > start, 'current production RE block located without editing shared source');
  let outcome;
  const run = new Function('reverse', 'repoRoot', 'error', 'join', 'existsSync', 'readFileSync', 'execFileSync', 'preserve', 'writeFileSync', 'finish', source.slice(start, end));
  run(
    local,
    repoRoot,
    null,
    join,
    (path) => {
      try {
        readFileSync(path);
        return true;
      } catch {
        return false;
      }
    },
    readFileSync,
    execFileSync,
    () => {},
    writeFileSync,
    (_id, status) => {
      outcome = status;
    },
  );
  return { sourceSha256: sha(source.slice(start, end)), outcome };
}

async function setupControl(name) {
  const root = realpathSync(mkdtempSync('/tmp/f016-re-owned-'));
  const artifactDir = join(out, name);
  const local = makeLocalSession({ root, out: artifactDir, repoRoot });
  await local.session.close();
  const target = seedGreetingCli(local.cwd);
  if (name === 'changed-greeting') writeFileSync(target, readFileSync(target, 'utf8').replace("print('Hello ' + args[1])", "print('Goodbye ' + args[1])"));
  const frozen = freezeReTarget({ target, env: local.env, attemptId: name });
  writeFileSync(local.wrapper, `#!/bin/sh\nexec /usr/bin/sandbox-exec -f ${quote(local.profile)} ${quote(pi)} -e ${quote(provider)} --provider f016-control --model scripted --thinking off "$@"\n`, { mode: 0o700 });
  writeFileSync(join(local.agentDir, 'settings.json'), JSON.stringify({ skills: [join(repoRoot, 'skills')], packages: [], extensions: [], cacheWarming: { enabled: false } }));
  const session = createRpcSession({
    packagePath: repoRoot,
    agentDir: local.agentDir,
    cwd: local.cwd,
    piBin: local.wrapper,
    env: { ...local.env, F016_PI_AI: ai, NODE_V8_COVERAGE: '' },
    capturePath: join(artifactDir, 'scripted-rpc.jsonl'),
    idleTimeoutMs: 120000,
  });
  return { root, artifactDir, local, target, frozen, session };
}

async function runControl(name) {
  const { root, artifactDir, local, target, frozen, session } = await setupControl(name);
  try {
    const re = join(local.cwd, '.re');
    const selected = name === 'help-only' ? contracts.slice(0, 1) : contracts;
    const cases = selected.map((item, index) => ({
      id: `control-renamed-${index}`,
      question: `What does ${JSON.stringify(item.args)} produce?`,
      safe: true,
      args: item.args,
      timeout: 5,
      expect: { exit_code: item.code, signal: null, timed_out: false, stdout_sha256: sha(item.stdout), stderr_sha256: sha(item.stderr) },
    }));
    const investigate = join(repoRoot, 'skills/reverse-engineer-cli/scripts/investigate.py');
    const steps = [
      bash(`python3 ${quote(investigate)} init --workspace ${quote(re)} --target ${quote(target)}`),
      write(join(re, 'probes/cases.json'), JSON.stringify(cases)),
      bash(`python3 ${quote(investigate)} run --workspace ${quote(re)}`),
      reportsCommand(re, target, name === 'initializer-spam'),
    ];
    await session.prompt(`F016_CONTROL ${JSON.stringify(steps)}`);
    assert.equal(session.records.filter((record) => record.type === 'tool_execution_start').length, 4);
    const legacy = legacyBlock({ ...local, out: artifactDir });
    const evidence = collectReEvidence({ frozen, cwd: local.cwd, out: artifactDir, profile: local.profile, env: local.env, repoRoot });
    const outcome = evaluateRe({ invocation: { error: null }, origin: 'scripted-control', evidence });
    assert.equal(outcome.eligible, name === 'complete-evidence');
    assert.equal(outcome.verdict, 'failed');
    assert.equal(outcome.genuineCompliance, false);
    assert.equal(outcome.manualReview, 'pending');
    if (name === 'changed-greeting') {
      const greeting = evidence.observations.find((item) => item.args[0] === 'hello');
      assert.equal(greeting.code, 0);
      assert.equal(greeting.stdout, 'Goodbye Ada\n');
    }
    if (['help-only', 'initializer-spam'].includes(name)) assert.equal(legacy.outcome.replayCode, 0);
    cpSync(local.cwd, join(artifactDir, 'workspace'), { recursive: true });
    const result = { name, version, scriptedControl: true, genuineCompliance: false, frozen, legacy, evidence, outcome };
    writeFileSync(join(artifactDir, 'outcome.json'), JSON.stringify(result, null, 2));
    return result;
  } finally {
    await session.close();
    rmSync(root, { recursive: true, force: true });
  }
}
const outcomes = [];
for (const name of ['help-only', 'changed-greeting', 'initializer-spam', 'complete-evidence']) outcomes.push(await runControl(name));
writeFileSync(join(out, 'summary.json'), JSON.stringify({ version, scriptedControl: true, genuineCompliance: false, outcomes }, null, 2));
