import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { test } from 'node:test';

import { seedGreetingCli } from '../helpers/resource-workflows-fixtures.mjs';
import { collectReEvidence, freezeReTarget } from '../helpers/resource-workflows-re-evidence.mjs';
import { evaluateRe } from '../helpers/resource-workflows-re-outcome.mjs';

const repoRoot = resolve('.');
const sha = (value) => createHash('sha256').update(value).digest('hex');
const expected = [
  { args: ['--help'], stdout: 'Usage: greet hello NAME\n', stderr: '', code: 0 },
  { args: ['--version'], stdout: 'greet 1.0.0\n', stderr: '', code: 0 },
  { args: ['hello', 'Ada'], stdout: 'Hello Ada\n', stderr: '', code: 0 },
  { args: [], stdout: '', stderr: 'Usage: greet hello NAME\n', code: 2 },
];
function fixture(root, variant = 'complete') {
  const cwd = join(root, 'workspace');
  const out = join(root, 'out');
  mkdirSync(cwd, { recursive: true });
  mkdirSync(out, { recursive: true });
  const target = seedGreetingCli(cwd);
  if (variant === 'wrong-greeting') writeFileSync(target, readFileSync(target, 'utf8').replace("print('Hello ' + args[1])", "print('Goodbye ' + args[1])"));
  const frozen = freezeReTarget({ target, attemptId: variant });
  const re = join(cwd, '.re');
  const investigate = join(repoRoot, 'skills/reverse-engineer-cli/scripts/investigate.py');
  execFileSync('python3', [investigate, 'init', '--workspace', re, '--target', target]);
  const cases = (variant === 'help-only' ? expected.slice(0, 1) : expected).map((item, i) => ({
    id: `arbitrary-${i}`,
    question: `What does ${JSON.stringify(item.args)} produce?`,
    safe: true,
    args: item.args,
    timeout: 5,
    expect: { exit_code: item.code, signal: null, timed_out: false, stdout_sha256: sha(item.stdout), stderr_sha256: sha(item.stderr) },
  }));
  writeFileSync(join(re, 'probes/cases.json'), JSON.stringify(cases));
  if (variant !== 'wrong-greeting') execFileSync('python3', [investigate, 'run', '--workspace', re]);
  if (variant !== 'initializer-spam' && variant !== 'wrong-greeting') addReportEvidence(re, target, cases);
  return { frozen, cwd, out, repoRoot, env: {}, re, target };
}

function addReportEvidence(re, target, cases) {
  const records = readFileSync(join(re, 'probes/results.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
  const links = records.map(
    (item) => `Probe: ${item.id}. Scope argv ${JSON.stringify(item.argv.slice(1))}. Exit ${item.exit_code}.\n[stdout](${relative(join(re, 'report'), item.stdout.path)}) [stderr](${relative(join(re, 'report'), item.stderr.path)})`,
  );
  for (const name of ['behavior', 'evidence']) writeFileSync(join(re, 'report', `${name}.md`), `# ${name}\n\n${links.join('\n\n')}\n\nNetwork and platform extensions are excluded. Unmeasured process effects remain unknown.\n`);
  writeFileSync(
    join(re, 'report/architecture.md'),
    `# Architecture\n\n[entrypoint](${target}) is an executable Python script. sys.argv selects help, version, hello or usage failure. Parsing and presentation are in the script. No external adapter is needed in the bounded scope. Runtime internals and platform variants remain uninvestigated.\n`,
  );
  writeFileSync(join(re, 'source/entrypoints.json'), JSON.stringify([{ path: target, sha256: sha(readFileSync(target)) }]));
  writeFileSync(
    join(re, 'source/command-tree.json'),
    JSON.stringify({
      command: 'greet',
      options: [
        { long: '--help', evidence: [cases[0].id] },
        { long: '--version', evidence: [cases[1]?.id] },
      ],
      arguments: [],
      evidence: cases.map((item) => item.id),
      subcommands: [{ command: 'hello', arguments: [{ name: 'NAME' }], options: [], subcommands: [], evidence: [cases[2]?.id] }],
    }),
  );
}

function ownedTest(name, variant, assertion) {
  test(name, () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'f016-re-test-')));
    try {
      assertion(fixture(root, variant));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
}
ownedTest('help-only corpus cannot cover greeting and usage', 'help-only', (input) => {
  assert.equal(collectReEvidence(input).corpusComplete, false);
});
ownedTest('initializer report spam is not claim-linked evidence', 'initializer-spam', (input) => {
  const evidence = collectReEvidence(input);
  assert.equal(evidence.reportsLinked, false);
  assert.equal(evaluateRe({ invocation: { error: null }, origin: 'scripted-control', evidence }).eligible, false);
});
ownedTest('complete corpus with renamed IDs and real raw links is eligible only for manual review', 'complete', (input) => {
  const evidence = collectReEvidence(input);
  assert.equal(evidence.identityMatches, true);
  assert.equal(evidence.sourceMatches, true);
  assert.equal(evidence.reportsLinked, true);
  assert.equal(evidence.corpusComplete, true);
  assert.deepEqual(
    evidence.observations.map(({ args, stdout, stderr, code }) => ({ args, stdout, stderr, code })),
    expected,
  );
  assert.equal(evidence.replayCode, 0);
  assert.deepEqual(
    evidence.replayObservations.map(({ args, stdout, stderr, code }) => ({ args, stdout, stderr, code })),
    expected,
  );
  const result = evaluateRe({ invocation: { error: null }, origin: 'scripted-control', evidence });
  assert.equal(result.eligible, true);
  assert.equal(result.manualReview, 'pending');
  assert.equal(result.verdict, 'failed');
});
ownedTest('changed greeting with exit zero fails literal output despite a stable frozen hash', 'wrong-greeting', (input) => {
  const evidence = collectReEvidence(input);
  const greeting = evidence.observations.find((item) => item.args[0] === 'hello');
  assert.equal(greeting.code, 0);
  assert.equal(greeting.stdout, 'Goodbye Ada\n');
  assert.equal(evaluateRe({ invocation: { error: null }, origin: 'scripted-control', evidence }).eligible, false);
});
ownedTest('post-freeze target edits block execution', 'complete', (input) => {
  writeFileSync(input.target, ['#!/usr/bin/env python3', 'print(1)', ''].join('\n'));
  const evidence = collectReEvidence(input);
  assert.equal(evidence.identityMatches, false);
  assert.deepEqual(evidence.observations, []);
});
ownedTest('exit-only assertions do not authorize replay', 'complete', (input) => {
  const cases = JSON.parse(readFileSync(join(input.re, 'probes/cases.json')));
  writeFileSync(join(input.re, 'probes/cases.json'), JSON.stringify(cases.map((item) => ({ ...item, expect: { exit_code: item.expect.exit_code } }))));
  const evidence = collectReEvidence(input);
  assert.equal(evidence.corpusComplete, false);
  assert.equal(evidence.replayCode, null);
});
ownedTest('copied probe tampering blocks replay', 'complete', (input) => {
  writeFileSync(join(input.re, 'repro/scripts/probe.py'), ['print("wrong")', ''].join('\n'));
  const evidence = collectReEvidence(input);
  assert.equal(evidence.replayCode, null);
  assert.equal(
    evidence.issues.some((item) => item.includes('helper')),
    true,
  );
});
ownedTest('raw link for a different invocation does not satisfy its claim', 'complete', (input) => {
  const path = join(input.re, 'report/evidence.md');
  const records = readFileSync(join(input.re, 'probes/results.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
  writeFileSync(path, readFileSync(path, 'utf8').replace(relative(join(input.re, 'report'), records[2].stdout.path), relative(join(input.re, 'report'), records[0].stdout.path)));
  assert.equal(collectReEvidence(input).reportsLinked, false);
});
ownedTest('malformed corpus returns a gap instead of throwing', 'complete', (input) => {
  writeFileSync(join(input.re, 'probes/cases.json'), '[null]');
  const evidence = collectReEvidence(input);
  assert.equal(evidence.corpusComplete, false);
  assert.equal(evidence.replayCode, null);
});

ownedTest('actual replay streams remain readable after the owned scratch workspace is removed', 'complete', (input) => {
  const evidence = collectReEvidence(input);
  rmSync(input.re, { recursive: true });
  assert.deepEqual(
    evidence.replayObservations.map((item) => ({ args: item.args, stdout: readFileSync(item.stdoutPath, 'utf8'), stderr: readFileSync(item.stderrPath, 'utf8'), code: item.code })),
    expected,
  );
});

ownedTest('neighbor Python modules cannot execute during authenticated replay', 'complete', (input) => {
  const marker = join(input.cwd, 'import-executed');
  writeFileSync(join(input.re, 'repro/scripts/argparse.py'), `from pathlib import Path\nPath(${JSON.stringify(marker)}).write_text('unsafe import')\nraise RuntimeError('shadow module')\n`);
  const evidence = collectReEvidence(input);
  assert.equal(existsSync(marker), false);
  assert.equal(evidence.replayCode, 0);
});
ownedTest('PATH shadowing cannot replace the frozen interpreter', 'complete', (input) => {
  const directory = join(input.cwd, 'shadow');
  mkdirSync(directory);
  const marker = join(input.cwd, 'runtime-replaced');
  writeFileSync(join(directory, 'python3'), `#!/bin/sh\nprintf shadow > '${marker}'\nexec '${input.frozen.runtime}' "$@"\n`, { mode: 0o755 });
  const evidence = collectReEvidence({ ...input, env: { PATH: `${directory}:${process.env.PATH}` } });
  assert.equal(existsSync(marker), false);
  assert.equal(evidence.identityMatches, true);
  assert.equal(evidence.replayCode, 0);
});
ownedTest('claim links have host-owned comparisons to actual fresh replay observations', 'complete', (input) => {
  const evidence = collectReEvidence(input);
  assert.equal(evidence.linkAudits.length, 4);
  assert.equal(
    evidence.linkAudits.every((item) => item.matches === true && item.actualRun === evidence.replay.run),
    true,
  );
  assert.equal(evidence.manualGaps.includes('Original agent-recorded capture provenance is not authenticated.'), true);
});

ownedTest('unsafe argv, environment, timing and I/O controls block replay', 'complete', (input) => {
  const path = join(input.re, 'probes/cases.json');
  const original = JSON.parse(readFileSync(path));
  for (const override of [
    { args: ['download'] },
    { safe: false },
    { question: '' },
    { timeout: 0 },
    { timeout: 11 },
    { tty: 'both' },
    { stdin_mode: 'pipe' },
    { stdin_text: 'input' },
    { seed: ['external:file'] },
    { env: { PYTHONPATH: '/tmp' } },
    { env: null },
    { expect: null },
  ]) {
    writeFileSync(path, JSON.stringify(original.map((item, index) => (index === 0 ? { ...item, ...override } : item))));
    const evidence = collectReEvidence(input);
    assert.equal(evidence.corpusComplete, false);
    assert.equal(evidence.replayCode, null);
  }
});
ownedTest('dangling source and wrong artifact identity cannot establish eligibility', 'complete', (input) => {
  writeFileSync(join(input.re, 'source/entrypoints.json'), JSON.stringify([{ path: join(input.cwd, 'missing'), sha256: input.frozen.sha256 }]));
  assert.equal(collectReEvidence(input).sourceMatches, false);
  const path = join(input.re, 'target/identity.json');
  const identity = JSON.parse(readFileSync(path));
  writeFileSync(path, JSON.stringify({ ...identity, sha256: '0'.repeat(64) }));
  assert.equal(collectReEvidence(input).identityMatches, false);
});
ownedTest('altered raw bytes and broken JSON are explicit collection gaps', 'complete', (input) => {
  const record = JSON.parse(readFileSync(join(input.re, 'probes/results.jsonl'), 'utf8').split('\n')[0]);
  writeFileSync(record.stdout.path, 'false evidence');
  assert.deepEqual(collectReEvidence(input).issues, ['Raw stream hash mismatch.']);
  writeFileSync(join(input.re, 'probes/cases.json'), '{');
  const evidence = collectReEvidence(input);
  assert.equal(evidence.corpusComplete, false);
  assert.equal(evidence.issues.length, 1);
});
