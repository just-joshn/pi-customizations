import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import { captureReference, comparePackaged, GREETING_CASES, processObservation } from '../helpers/resource-workflows-contract.mjs';
import { seedGreetingCli, seedSimplify } from '../helpers/resource-workflows-fixtures.mjs';
import { collectDifferential, evidenceMapLinks, readOwnedJson } from '../helpers/resource-workflows-implementation-evidence.mjs';
import { evaluateImplementation } from '../helpers/resource-workflows-implementation-outcome.mjs';
import { makeLocalSession } from '../helpers/resource-workflows-local.mjs';
import { collectSimplifyEvidence } from '../helpers/resource-workflows-simplify-evidence.mjs';
import { evaluateSimplify } from '../helpers/resource-workflows-simplify-outcome.mjs';
import { createRpcSession } from '../lib/rpc.mjs';

const repoRoot = resolve('.');
const out = resolve(process.argv[2] ?? join('artifacts/verify-pi-customizations/f016-bounded-oracles/control-runs', String(Date.now())));
mkdirSync(out, { recursive: true });
const pi = realpathSync(execFileSync('/bin/sh', ['-c', 'command -v pi'], { encoding: 'utf8' }).trim());
const version = execFileSync(pi, ['--version'], { encoding: 'utf8' }).trim();
assert.equal(version, '1.1.0');
const piAi = realpathSync(join(dirname(dirname(pi)), 'install/releases', version, 'node_modules/@earendil-works/pi-ai/dist/index.js'));
const provider = join(repoRoot, '.pi/skills/verify-pi-customizations/helpers/resource-workflows-control-provider.mjs');
const quote = (value) => `'${value.replaceAll("'", "'\\''")}'`;
const outcomes = [];

async function fixture(name, run) {
  const root = mkdtempSync('/tmp/f016-oracle-control-');
  const artifactDir = join(out, name);
  const local = makeLocalSession({ root, out: artifactDir, repoRoot, packagePath: join(repoRoot, 'extensions/pi-pstack') });
  await local.session.close();
  writeFileSync(local.wrapper, `#!/bin/sh\nexec /usr/bin/sandbox-exec -f ${quote(local.profile)} ${quote(pi)} -e ${quote(provider)} --provider f016-control --model scripted --thinking off "$@"\n`, { mode: 0o700 });
  writeFileSync(join(local.agentDir, 'settings.json'), JSON.stringify({ defaultProvider: 'f016-control', defaultModel: 'scripted', skills: [], extensions: [provider], packages: [], cacheWarming: { enabled: false } }));
  const session = createRpcSession({
    packagePath: join(repoRoot, 'extensions/pi-pstack'),
    agentDir: local.agentDir,
    cwd: local.cwd,
    piBin: local.wrapper,
    env: { ...local.env, NODE_V8_COVERAGE: '', F016_PI_AI: piAi },
    capturePath: join(artifactDir, 'scripted-rpc.jsonl'),
    idleTimeoutMs: 120000,
  });
  try {
    const result = await run({ ...local, env: { ...local.env, NODE_V8_COVERAGE: '' }, root, session, artifactDir });
    cpSync(local.cwd, join(artifactDir, 'workspace'), { recursive: true });
    outcomes.push({ name, scriptedControl: true, genuineCompliance: false, preservedWorkspace: join(artifactDir, 'workspace'), ...result });
    writeFileSync(join(artifactDir, 'outcome.json'), JSON.stringify(result, null, 2));
  } finally {
    await session.close();
    rmSync(root, { recursive: true, force: true });
  }
}
const bash = (command) => ({ name: 'bash', arguments: { command } });
const prompt = (session, steps) => session.prompt(`F016_CONTROL ${JSON.stringify(steps)}`);
const observe = (local, args) => {
  const result = processObservation('/usr/bin/sandbox-exec', ['-f', local.profile, 'node', ...args], { cwd: local.cwd, env: { ...process.env, ...local.env } });
  return { ...result, stdout: result.stdout.toString(), stderr: result.stderr.toString() };
};

for (const name of ['wrong-greeting', 'four-sync', 'four-requests-no-results', 'simplify-positive']) {
  await fixture(name, async (local) => {
    seedSimplify(local.cwd);
    const before = readFileSync(join(local.cwd, 'greeting.test.mjs'), 'utf8');
    const parentSessionId = (await local.session.state()).sessionId;
    const positive = name === 'simplify-positive';
    const steps =
      name === 'wrong-greeting'
        ? [bash(`printf '%s\\n' 'export const greet = () => "Wrong Ada";' > greeting.mjs`)]
        : ['reuse', 'simplification', 'efficiency', 'altitude'].map((angle) => ({
            name: 'Task',
            arguments: {
              prompt: `Read-only ${angle} review. Return findings only. F016_HOLD`,
              subagent_type: name === 'four-requests-no-results' ? 'nonexistent-f016-control-agent' : 'generalPurpose',
              readonly: true,
              run_in_background: positive,
            },
          }));
    const drain = positive ? [0, 1, 2, 3].map((childIndex) => ({ name: 'TaskOutput', arguments: { childIndex } })) : [];
    await prompt(local.session, [...steps, ...drain]);
    const greetingProgram = ['import { greet } from "./greeting.mjs";', 'const results = [greet("Ada"), greet("")];', 'process.stdout.write(JSON.stringify(results) + "\\n");'].join('\n');
    const facts = {
      invocation: { error: null },
      execution: { tests: observe(local, ['--test', 'greeting.test.mjs']), greeting: observe(local, ['--input-type=module', '-e', greetingProgram]) },
      results: { testsUnchanged: readFileSync(join(local.cwd, 'greeting.test.mjs'), 'utf8') === before },
      evidence: collectSimplifyEvidence({ records: local.session.records, root: local.root, cwd: local.cwd, parentSessionId, out: local.artifactDir }),
      rescue: { performed: false },
    };
    const outcome = evaluateSimplify(facts);
    assert.equal(outcome.eligible, positive);
    assert.equal(outcome.verdict, 'failed');
    assert.equal(facts.results.testsUnchanged, true);
    if (name === 'wrong-greeting') assert.equal(outcome.missing.includes('literal greeting results'), true);
    const requests = local.session.records.filter((record) => record.type === 'tool_execution_start' && record.toolName === 'Task').length;
    if (name !== 'wrong-greeting') assert.equal(requests, 4);
    return { facts, outcome, requests, remaining: 'Scripted controls do not prove genuine simplify compliance.' };
  });
}

for (const name of ['candidate-plus-cat', 'implementation-positive']) {
  await fixture(name, async (local) => {
    const target = seedGreetingCli(local.cwd);
    const artifact = join(local.cwd, 'greet.pyz');
    const candidateAbsentAtCapture = !existsSync(artifact);
    const reference = captureReference({ target, cwd: local.cwd, env: { ...process.env, ...local.env }, out: join(local.artifactDir, 'reference') });
    const compat = join(local.cwd, 'compat');
    mkdirSync(compat);
    cpSync(reference.directory, join(compat, 'reference', reference.sha), { recursive: true });
    const cases = join(compat, 'cases.json');
    writeFileSync(cases, JSON.stringify(GREETING_CASES.map((item) => ({ id: item.id, args: item.args, probe: ['--isolate', '--clean-env'] }))));
    const driver = join(repoRoot, 'skills/implement-cli-from-contract/scripts/differential.py');
    const reportPath = join(local.cwd, 'report.json');
    const mapPath = join(local.cwd, 'evidence-map.json');
    const reportAbsentBeforeInvocation = !existsSync(reportPath);
    const mapAbsentBeforeInvocation = !existsSync(mapPath);
    const packageProgram = ['import pathlib, zipapp', 'pathlib.Path("candidate").mkdir()', 'pathlib.Path("candidate/__main__.py").write_bytes(pathlib.Path("greet").read_bytes())', 'zipapp.create_archive("candidate", "greet.pyz")'].join(
      '\n',
    );
    const steps = [bash(`python3 - <<'PY'\n${packageProgram}\nPY`)];
    if (name === 'candidate-plus-cat') steps.push(bash(`cat ${quote(driver)}`));
    else {
      steps.push(bash(`python3 ${quote(driver)} run ${quote(cases)} --reference ${quote(target)} --candidate ${quote(`python3 ${artifact}`)} --out ${quote(join(compat, 'differential'))}`));
      const reportProgram = [
        'import hashlib, json, pathlib',
        `ids = ${JSON.stringify(['help', 'version', 'greeting', 'empty-name', 'unicode', 'invalid'])}`,
        'sha = lambda name: hashlib.sha256(pathlib.Path(name).read_bytes()).hexdigest()',
        'report = {"reference": {"sha256": sha("greet")}, "candidate": {"artifact_sha256": sha("greet.pyz")}, "cases": {"total": 6, "passed": 6, "failed": 0}, "intentional_differences": []}',
        'pathlib.Path("report.json").write_text(json.dumps(report))',
        'evidence = [{"case": case, "behavior": "Exact streams and status " + case, "implementation": "candidate/__main__.py", "test": "compat/differential/candidate/probes.jsonl#" + case, "probe": "compat/reference/" + sha("greet") + "/" + case + "/meta.json"} for case in ids]',
        'pathlib.Path("evidence-map.json").write_text(json.dumps(evidence))',
      ].join('\n');
      steps.push(bash(`python3 - <<'PY'\n${reportProgram}\nPY`));
    }
    await prompt(local.session, steps);
    const comparison = comparePackaged({ artifact, reference, cwd: local.cwd, env: { ...process.env, ...local.env }, profile: local.profile });
    assert.equal(comparison.allMatched, true);
    const map = readOwnedJson(mapPath, local.cwd);
    const facts = {
      invocation: { error: null },
      execution: { differential: collectDifferential({ records: local.session.records, cwd: local.cwd, driver, target, artifact, cases, reference }) },
      evidence: { capturedBeforeInvocation: true, candidateAbsentAtCapture, reportAbsentBeforeInvocation, mapAbsentBeforeInvocation, report: readOwnedJson(reportPath, local.cwd), map, mapLinks: evidenceMapLinks(map, local.cwd) },
      results: { referenceSha256: reference.sha, artifactSha256: comparison.artifactSha256, reference: target, candidate: artifact, cases, comparison },
      rescue: { performed: false },
    };
    const outcome = evaluateImplementation(facts);
    assert.equal(outcome.eligible, name === 'implementation-positive');
    assert.equal(outcome.verdict, 'failed');
    return { facts, outcome };
  });
}
writeFileSync(join(out, 'summary.json'), JSON.stringify({ version, scriptedControl: true, genuineCompliance: false, outcomes }, null, 2));
