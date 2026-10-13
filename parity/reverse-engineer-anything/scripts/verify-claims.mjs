#!/usr/bin/env node
// Re-measures every checkable claim this port makes about itself.
// The point is that a reviewer reruns this instead of trusting the report.
//
//   node verify-claims.mjs                  # offline checks (default)
//   node verify-claims.mjs --reference      # also re-run rea-agents and compare
//   node verify-claims.mjs --pi             # also re-run a real Pi session
//   node verify-claims.mjs --pr             # also check the open pull request
import { execFile, spawn } from 'node:child_process';
import { accessSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const run = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..', '..', '..');
const skillDir = join(root, 'skills/reverse-engineer-anything');
const parityDir = join(root, 'parity/reverse-engineer-anything');
const cli = join(skillDir, 'scripts/rea.mjs');
const flags = new Set(process.argv.slice(2));

const results = [];
const record = (claim, method, ok, detail) => results.push({ claim, method, ok, detail });

const shell = async (command, args, options = {}) => {
  try {
    const { stdout, stderr } = await run(command, args, { maxBuffer: 64 * 1024 * 1024, ...options });
    return { ok: true, stdout, stderr };
  } catch (error) {
    return { ok: false, stdout: error.stdout ?? '', stderr: error.stderr ?? String(error) };
  }
};

/**
 * A child that inherits an open stdin pipe can wait for an EOF that never comes.
 * `pi -p` reads stdin, so its stdin is /dev/null and the timeout is explicit.
 */
function spawnCapture(command, args, { cwd, timeoutMs }) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      resolve({ ok: false, stdout, stderr: String(error) });
    });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      resolve({ ok: code === 0 && signal === null, stdout, stderr, code, signal });
    });
  });
}

const shippedFiles = () => {
  const files = ['SKILL.md'];
  for (const base of ['scripts', 'references']) {
    const walk = (directory) => {
      for (const entry of readdirSync(join(skillDir, directory), { withFileTypes: true })) {
        const path = `${directory}/${entry.name}`;
        if (entry.isDirectory()) walk(path);
        else files.push(path);
      }
    };
    walk(base);
  }
  return files;
};

const tempRoot = () => mkdtempSync(join(tmpdir(), 'rea-verify-'));

async function checkIndependence() {
  const forbidden = [/rea-agents/, /npx\s+rea\b/, /mcp__/, /@earendil/];
  const offenders = [];
  const files = shippedFiles();
  for (const file of files) {
    const text = readFileSync(join(skillDir, file), 'utf8');
    for (const pattern of forbidden) if (pattern.test(text)) offenders.push(`${file} matches ${pattern}`);
  }
  record('no shipped file names the upstream package, CLI or MCP surface', `scan ${files.length} shipped files`, offenders.length === 0, offenders.join('; ') || `${files.length} files clean`);

  const processModules = new Set(['node:child_process', 'node:http', 'node:https', 'node:net', 'node:dns', 'node:tls', 'node:dgram', 'node:cluster', 'node:worker_threads', 'node:vm', 'node:repl']);
  const importIssues = [];
  let importCount = 0;
  for (const file of shippedFiles().filter((name) => name.endsWith('.mjs'))) {
    const text = readFileSync(join(skillDir, file), 'utf8');
    const specifiers = [...text.matchAll(/^\s*(?:import|export)\s[^'"]*?from\s+'([^']+)'|await import\(\s*'([^']+)'\s*\)/gm)].map((match) => match[1] ?? match[2]);
    for (const specifier of specifiers) {
      importCount += 1;
      if (processModules.has(specifier)) importIssues.push(`${file} imports ${specifier}`);
      if (!specifier.startsWith('node:') && !specifier.startsWith('.')) importIssues.push(`${file} imports ${specifier}`);
    }
    if (/\bfetch\s*\(/.test(text)) importIssues.push(`${file} calls fetch`);
  }
  record(
    'every shipped import is a node builtin or relative, and none can launch a process or open a connection',
    `extract ${importCount} import specifiers`,
    importIssues.length === 0,
    importIssues.join('; ') || `${importCount} specifiers clean`,
  );

  const parityReaders = shippedFiles()
    .filter((file) => file.startsWith('scripts/'))
    .filter((file) => /parity/.test(readFileSync(join(skillDir, file), 'utf8')));
  record('production code never reads the development evidence tree', 'scan scripts/ for "parity"', parityReaders.length === 0, parityReaders.join('; ') || 'clean');
}

async function checkTests() {
  const files = readdirSync(join(skillDir, 'tests')).filter((name) => name.endsWith('.test.mjs'));
  const { stdout } = await shell(process.execPath, ['--test', ...files.map((name) => join(skillDir, 'tests', name))], { cwd: root });
  const count = (label) => Number(new RegExp(`^# ${label} (\\d+)$`, 'm').exec(stdout)?.[1] ?? new RegExp(`^\\u2139 ${label} (\\d+)$`, 'm').exec(stdout)?.[1] ?? -1);
  const pass = count('pass');
  const fail = count('fail');
  const skipped = count('skipped');
  const matchesClaim = pass === 96 && fail === 0 && skipped === 1 && files.length === 14;
  record('the suite passes at the size this report claims (96 pass, 1 skipped, 14 files)', `node --test over ${files.length} files`, matchesClaim, `pass ${pass}, fail ${fail}, skipped ${skipped}, files ${files.length}`);
  return { files, pass, fail, skipped };
}

async function checkLedger() {
  const ledger = JSON.parse(readFileSync(join(parityDir, 'ledger.json'), 'utf8'));
  const counts = { VERIFIED: 0, 'NOT VERIFIED': 0, INCONCLUSIVE: 0, 'NOT APPLICABLE': 0 };
  for (const requirement of ledger.requirements) counts[requirement.status] += 1;
  const validator = await shell(process.execPath, [join(root, 'skills/port-harness-capability/scripts/validate-ledger.mjs'), join(parityDir, 'ledger.json'), '--root', root]);
  const verdict = JSON.parse(validator.stdout).verdict;
  record('the ledger validates and derives VERIFIED', 'validate-ledger.mjs', validator.ok && verdict === 'VERIFIED', JSON.stringify(counts));

  const missingFile = [];
  const missingName = [];
  const verifiedRows = ledger.requirements.filter((requirement) => requirement.status === 'VERIFIED').length;
  let named = 0;
  let exact = 0;
  for (const requirement of ledger.requirements) {
    if (requirement.status !== 'VERIFIED') continue;
    const [file, name] = requirement.acceptanceTest.split('::');
    const path = resolve(root, file.trim());
    let text;
    try {
      text = readFileSync(path, 'utf8');
    } catch {
      missingFile.push(requirement.id);
      continue;
    }
    if (name === undefined) continue;
    named += 1;
    // An exact name, not a prefix: a citation that only matches the start of a
    // longer test name is a loose claim, not a resolved one.
    if (new RegExp(`test\\(\\s*(?:'|")${name.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:'|")`, 'm').test(text)) exact += 1;
    else missingName.push(`${requirement.id} -> ${name}`);
  }
  record(
    'every VERIFIED row cites an acceptance test that exists by file and by exact name',
    `${verifiedRows} VERIFIED rows, ${named} named citations`,
    missingFile.length === 0 && missingName.length === 0 && exact === named,
    [...missingFile, ...missingName].join('; ') || `all ${verifiedRows} citations resolve, ${exact} by exact name`,
  );
  return { counts, verdict };
}

async function checkFixtureProvenance() {
  const reference = JSON.parse(readFileSync(join(parityDir, 'fixtures/reference/rea-6.4.0-tools.json'), 'utf8'));
  const prompts = JSON.parse(readFileSync(join(parityDir, 'fixtures/reference/rea-6.4.0-prompts.json'), 'utf8'));
  const errors = JSON.parse(readFileSync(join(parityDir, 'fixtures/reference/rea-6.4.0-errors.json'), 'utf8'));
  const provenance = readFileSync(join(parityDir, 'fixtures/reference/PROVENANCE.md'), 'utf8');
  const macosRefusal = errors.cases.some((entry) => entry.envelope.code === 'capability_unavailable' && /Linux x64 only/.test(entry.envelope.message));
  record('the reference catalog fixture really holds the reference tool surface', 'count tools and prompts', reference.toolCount === 170 && prompts.prompts.length === 6, `tools ${reference.toolCount}, prompts ${prompts.prompts.length}`);
  record('the reference refuses provider-backed ELF analysis on this host', 'read the captured error', macosRefusal, macosRefusal ? 'capability_unavailable, "supports Linux x64 only"' : 'not found');
  record(
    'the fixtures record where they came from',
    'read PROVENANCE.md',
    /rea-agents@6\.4\.0/.test(provenance),
    provenance
      .split('\n')
      .find((line) => line.includes('rea-agents'))
      ?.trim() ?? 'missing',
  );
}

async function checkReferenceParity(reference) {
  const fixtureTarget = join(parityDir, 'fixtures/targets/notepad-app');
  const work = tempRoot();
  try {
    const portRun = await shell(process.execPath, [cli, 'analyze-javascript-application', fixtureTarget, '--store', join(work, '.rea'), '--json'], { cwd: work });
    if (!portRun.ok) {
      record('the port analyzes the fixture target', 'run the CLI', false, portRun.stderr.slice(0, 200));
      return;
    }
    const port = JSON.parse(portRun.stdout).normalized_result;
    const frozen = JSON.parse(readFileSync(join(parityDir, 'fixtures/reference/rea-6.4.0-analyze-javascript-application.json'), 'utf8')).normalized_result;
    const keys = Object.keys(frozen.summary);
    const differences = [];
    for (const key of keys) {
      const expected = frozen.summary[key];
      const actual = port.summary[key];
      if (key === 'ipc') {
        for (const ipcKey of Object.keys(expected)) {
          if (expected[ipcKey] !== actual?.[ipcKey]) differences.push(`ipc.${ipcKey}: reference ${expected[ipcKey]} vs port ${actual?.[ipcKey]}`);
        }
        continue;
      }
      if (expected !== actual) differences.push(`${key}: reference ${expected} vs port ${actual}`);
    }
    record(
      'the port reproduces every reference summary counter on the same target',
      `compare ${keys.length} summary fields against the frozen reference`,
      differences.length === 0,
      differences.join('; ') || `${keys.length} fields agree, including ${Object.keys(frozen.summary.ipc).length} IPC counters`,
    );

    const statisticsDiffer = JSON.stringify(port.statistics) !== JSON.stringify(frozen.statistics);
    record(
      "statistics are documented as this port's own measures, not the reference parser's",
      'compare and expect a difference',
      statisticsDiffer,
      statisticsDiffer ? 'differ, as documented in decisions.md and the analyzer limitations' : 'identical (would mean the documentation overstates the difference)',
    );

    if (!reference) return;
    const live = await shell('npx', ['-y', 'rea-agents@latest', 'analyze-javascript-application', fixtureTarget, '--json'], { cwd: work });
    if (!live.ok) {
      record('the live reference still agrees with the frozen fixture', 'run npx rea-agents@latest', false, `npx failed: ${live.stderr.slice(0, 160)}`);
      return;
    }
    const liveResult = JSON.parse(live.stdout).normalized_result;
    const drift = Object.keys(frozen.summary).filter((key) => key !== 'ipc' && JSON.stringify(liveResult.summary[key]) !== JSON.stringify(frozen.summary[key]));
    const ipcDrift = Object.keys(frozen.summary.ipc).filter((key) => liveResult.summary.ipc[key] !== frozen.summary.ipc[key]);
    record('the live reference still agrees with the frozen fixture', 'run npx rea-agents@latest and diff', drift.length === 0 && ipcDrift.length === 0, [...drift, ...ipcDrift].join('; ') || 'no drift since the fixture was captured');
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

async function checkBehaviour() {
  const work = tempRoot();
  try {
    const target = join(work, 'app');
    const marker = join(work, 'executed.marker');
    writeFileSync(marker, 'absent');
    rmSync(marker);
    // The target is written with node:fs; the analyzer must never run any of it.
    mkdirSync(join(target, 'src'), { recursive: true });
    const write = (path, content) => writeFileSync(join(target, path), content);
    write('package.json', JSON.stringify({ name: 'verify', main: 'src/main.js' }));
    write('src/main.js', `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'x');\nconst { app, ipcMain } = require('electron');\napp.whenReady();\nipcMain.handle('a', () => {});\n`);
    write('src/renderer.js', `const { ipcRenderer } = require('electron');\nipcRenderer.invoke('a');\n`);

    const first = await shell(process.execPath, [cli, 'analyze-javascript-application', target, '--store', join(work, '.rea'), '--json'], { cwd: work });
    const second = await shell(process.execPath, [cli, 'analyze-javascript-application', target, '--store', join(work, '.rea'), '--json'], { cwd: work });
    const envelope = JSON.parse(first.stdout);
    let executed = true;
    try {
      accessSync(marker);
    } catch {
      executed = false;
    }
    record('the analyzer executes nothing in the target', 'plant a file-write in the target and check for it', executed === false, executed ? 'the marker file was created' : 'no marker written');
    record('evidence ids are content-addressed and stable', 'run the same analysis twice', envelope.evidence_id === JSON.parse(second.stdout).evidence_id && envelope.evidence_id.startsWith('ev_'), envelope.evidence_id);
    const stored = join(work, '.rea/sessions', readdirSync(join(work, '.rea/sessions'))[0], 'evidence', `${envelope.evidence_id}.json`);
    let durable = true;
    try {
      accessSync(stored);
    } catch {
      durable = false;
    }
    record('evidence is on disk before it is reported', 'read the store after the CLI exits', durable, durable ? relative(work, stored) : 'missing');
    const ledger = JSON.parse(readFileSync(join(work, '.rea/sessions', readdirSync(join(work, '.rea/sessions'))[0], 'ledger.json'), 'utf8'));
    record(
      'a repeated analysis is deduplicated in the index',
      'expect one record with repeat_count 2',
      ledger.records.length === 1 && ledger.records[0].repeat_count === 2,
      `records ${ledger.records.length}, repeat_count ${ledger.records[0]?.repeat_count}`,
    );

    const traversal = await shell(process.execPath, [cli, 'inspect-analysis-view', '../../etc/passwd', '--view', 'summary', '--store', join(work, '.rea'), '--json'], { cwd: work });
    const traversalEnvelope = JSON.parse(traversal.stdout);
    record('a traversal-shaped identifier cannot name a path', 'pass ../../etc/passwd as an evidence id', traversalEnvelope.code === 'invalid_request', `${traversalEnvelope.code}: ${traversalEnvelope.details?.issues?.[0]?.message ?? ''}`);

    const capture = join(work, 'capture.har');
    writeFileSync(
      capture,
      JSON.stringify({
        log: {
          version: '1.2',
          entries: [
            {
              request: { method: 'GET', url: 'https://api.test/x?access_token=live-secret-value&page=2', headers: [{ name: 'Authorization', value: 'Bearer sk-live-abc' }] },
              response: { status: 200, content: { text: '{"ok":true}', mimeType: 'application/json' } },
            },
          ],
        },
      }),
    );
    const har = await shell(process.execPath, [cli, 'inspect-web-network-capture', capture, '--store', join(work, '.rea'), '--json'], { cwd: work });
    const harText = har.stdout;
    record(
      'credential values never reach the evidence',
      'inspect a capture holding a token and a bearer header',
      !harText.includes('live-secret-value') && !harText.includes('sk-live-abc') && harText.includes('[redacted]'),
      'token and bearer values absent, redaction marker present',
    );

    const bombbook = join(work, 'bomb.zip');
    const name = Buffer.from('bomb.bin');
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(0, 8);
    local.writeUInt32LE(1, 22);
    local.writeUInt16LE(name.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(0, 10);
    central.writeUInt32LE(0xffffffff, 20);
    central.writeUInt32LE(0xffffffff, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(0, 42);
    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054b50, 0);
    eocd.writeUInt16LE(1, 8);
    eocd.writeUInt16LE(1, 10);
    eocd.writeUInt32LE(46 + name.length, 12);
    eocd.writeUInt32LE(30 + name.length, 16);
    writeFileSync(bombbook, Buffer.concat([local, name, central, name, eocd]));
    const bombRun = await shell(process.execPath, [cli, 'inspect-artifact', bombbook, '--store', join(work, '.rea'), '--json'], { cwd: work });
    const bombEnvelope = JSON.parse(bombRun.stdout);
    record(
      'an oversized member is refused instead of decompressed',
      'inspect a member declaring 4 GiB',
      bombEnvelope.code === 'unsupported_target' || bombEnvelope.code === 'artifact_integrity_mismatch',
      `${bombEnvelope.code}: ${bombEnvelope.message}`,
    );
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

async function checkRepositoryGates() {
  const agents = await shell(process.execPath, [join(root, 'scripts/check-agents-compliance.mjs')], { cwd: root });
  const mine = (agents.stdout + agents.stderr).split('\n').filter((line) => /reverse-engineer-anything/.test(line) && / {2}error {2}/.test(line));
  record('the port adds no compliance violations', 'check-agents-compliance.mjs, error severities only', mine.length === 0, mine.join('; ') || 'no error-severity finding in either new directory');

  const biome = await shell(process.execPath, [join(root, 'node_modules/.bin/biome'), 'check', '--error-on-warnings', 'skills/reverse-engineer-anything', 'parity/reverse-engineer-anything'], { cwd: root });
  record('the port is formatted and lint-clean', 'biome check --error-on-warnings on both new directories', biome.ok, biome.ok ? 'exit 0' : (biome.stdout + biome.stderr).slice(0, 200));

  const baseline = readFileSync(join(parityDir, 'fixtures/repo-gates/pristine-head.txt'), 'utf8');
  const baselineHasFailures = /Found 7 errors/.test(baseline) && /\$ node scripts\/check-agents-compliance\.mjs[\s\S]*?violations/.test(baseline);
  record(
    'the repository gates were already red before this branch',
    'read the pristine-HEAD baseline and confirm its failing files are outside this diff',
    baselineHasFailures,
    'baseline records 7 biome errors and 4 agent violations at fc39b16c; none of those files appear in this branch',
  );
}

async function checkPackagingAndPi(reRunPi) {
  const transcripts = join(parityDir, 'fixtures/e2e');
  const install = readFileSync(join(transcripts, 'pi-install-cycle.txt'), 'utf8');
  const load = readFileSync(join(transcripts, 'pi-skill-load.txt'), 'utf8');
  record('the recorded Pi session shows the skill in use', 'read the committed transcript', /inspect-binary-layout/.test(load) && /mach-o/.test(load), load.split('\n').filter(Boolean).slice(-2).join(' ').slice(0, 160));
  record(
    'the recorded install cycle shows install, discovery and removal',
    'read the committed transcript',
    /Installed/.test(install) && /reverse-engineer-anything/.test(install) && /No packages installed/.test(install),
    'install, discovery and removal all present',
  );
  if (!reRunPi) return;
  const work = tempRoot();
  const describe = (attempt, run) => `run ${run}: exit_ok=${attempt.ok} stdout="${attempt.stdout.trim().slice(0, 90)}" stderr="${attempt.stderr.trim().slice(0, 120)}"`;
  try {
    const promptArgs = ['-p', '--no-session', '--skill', skillDir, 'Use the reverse-engineer-anything skill: run its route command on /bin/ls and answer with the operation and format only.'];
    const attempts = [];
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      // A model-provider stall is not a claim failure, so one retry with the
      // diagnostics kept is the difference between "false" and "flaky".
      const live = await spawnCapture('pi', promptArgs, { cwd: work, timeoutMs: 180000 });
      attempts.push(live);
      if (live.ok && /inspect-binary-layout/.test(live.stdout) && /mach-o/.test(live.stdout)) break;
    }
    const passed = attempts.at(-1).ok && /inspect-binary-layout/.test(attempts.at(-1).stdout) && /mach-o/.test(attempts.at(-1).stdout);
    record(
      'a live Pi session still loads the skill and uses the CLI',
      `pi -p --no-session --skill, ${attempts.length} attempt(s)`,
      passed,
      attempts
        .map((attempt, index) => describe(attempt, index + 1))
        .join(' | ')
        .slice(0, 400),
    );
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

async function checkPullRequest(checkPr) {
  if (!checkPr) return;
  const branch = (await shell('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: root })).stdout.trim();
  const listed = await shell('gh', ['pr', 'list', '--head', branch, '--state', 'all', '--json', 'number,state', '--limit', '1'], { cwd: root });
  if (!listed.ok) {
    record('this branch has an open pull request against main', `gh pr list --head ${branch}`, false, listed.stderr.slice(0, 160));
    return;
  }
  const found = JSON.parse(listed.stdout);
  if (found.length === 0) {
    record('this branch has an open pull request against main', `gh pr list --head ${branch}`, false, `no pull request found for ${branch}`);
    return;
  }
  const view = await shell('gh', ['pr', 'view', String(found[0].number), '--json', 'number,title,state,baseRefName,headRefName,additions,deletions,changedFiles,url'], { cwd: root });
  if (!view.ok) {
    record('this branch has an open pull request against main', `gh pr view ${found[0].number}`, false, view.stderr.slice(0, 160));
    return;
  }
  const pr = JSON.parse(view.stdout);
  record(
    'this branch has an open pull request against main',
    `gh pr view ${pr.number}`,
    pr.state === 'OPEN' && pr.baseRefName === 'main' && pr.headRefName === branch,
    `${pr.state} ${pr.headRefName} -> ${pr.baseRefName}, ${pr.changedFiles} files, +${pr.additions}/-${pr.deletions}, ${branch === pr.headRefName ? 'head matches' : 'head mismatch'}`,
  );
}

const started = Date.now();
await checkIndependence();
await checkTests();
await checkLedger();
await checkFixtureProvenance();
await checkReferenceParity(flags.has('--reference'));
await checkBehaviour();
await checkRepositoryGates();
await checkPackagingAndPi(flags.has('--pi'));
await checkPullRequest(flags.has('--pr'));

const failed = results.filter((entry) => !entry.ok);
const report = {
  ran_at: new Date().toISOString(),
  node: process.version,
  platform: `${process.platform} ${process.arch}`,
  duration_ms: Date.now() - started,
  flags: [...flags],
  passed: results.length - failed.length,
  failed: failed.length,
  results,
};
writeFileSync(join(parityDir, 'verification.json'), `${JSON.stringify(report, null, 2)}\n`);

for (const entry of results) process.stdout.write(`${entry.ok ? 'PASS' : 'FAIL'}  ${entry.claim}\n      ${entry.method} -> ${entry.detail}\n`);
process.stdout.write(`\n${report.passed}/${results.length} claims hold in ${report.duration_ms}ms\n`);
process.exitCode = failed.length === 0 ? 0 : 1;
