import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';

import { reContracts } from './resource-workflows-re-outcome.mjs';

const sha = (value) => createHash('sha256').update(value).digest('hex');
const json = (path) => JSON.parse(readFileSync(path, 'utf8'));
const sameArgs = (a, b) => JSON.stringify(a) === JSON.stringify(b);
function within(path, root) {
  const rel = relative(realpathSync(root), realpathSync(path));
  if (rel === '..' || rel.startsWith('../') || isAbsolute(rel)) throw new Error('Evidence path escapes owned workspace.');
  return realpathSync(path);
}

export function freezeReTarget({ target, env = {}, attemptId = randomUUID() }) {
  const path = realpathSync(target);
  const source = readFileSync(path, 'utf8');
  const result = spawnSync('/bin/sh', ['-c', 'command -v python3'], { env: { ...process.env, ...env }, encoding: 'utf8', timeout: 5000 });
  if (result.status !== 0) throw new Error('Python runtime identity unavailable.');
  const runtime = realpathSync(result.stdout.trim());
  return Object.freeze({ attemptId, path, source, sha256: sha(readFileSync(path)), runtime, runtimeSha256: sha(readFileSync(runtime)) });
}

function execute(command, args, options) {
  const prefix = options.profile ? ['/usr/bin/sandbox-exec', '-f', options.profile, command] : [command];
  const result = spawnSync(prefix[0], [...prefix.slice(1), ...args], {
    cwd: options.cwd,
    env: { ...process.env, ...options.env },
    encoding: 'utf8',
    timeout: 30000,
    maxBuffer: 1048576,
  });
  return { code: result.status, signal: result.signal, error: result.error?.message ?? null, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

function independentlyObserve(frozen, options) {
  const directory = join(options.out, 'independent');
  mkdirSync(directory, { recursive: true });
  return reContracts.map((contract, index) => {
    const result = execute(frozen.path, contract.args, options);
    const observation = { args: contract.args, targetSha256: frozen.sha256, ...result };
    writeFileSync(join(directory, `${index}.stdout`), result.stdout);
    writeFileSync(join(directory, `${index}.stderr`), result.stderr);
    writeFileSync(join(directory, `${index}.json`), JSON.stringify(observation, null, 2));
    return observation;
  });
}

function unchanged(frozen) {
  return realpathSync(frozen.path) === frozen.path && sha(readFileSync(frozen.path)) === frozen.sha256 && sha(readFileSync(frozen.runtime)) === frozen.runtimeSha256;
}

function workspaceIdentity(re, frozen) {
  const identity = json(within(join(re, 'target/identity.json'), re));
  const artifacts = identity.artifacts;
  if (realpathSync(identity.target_path) !== frozen.path || identity.resolved_target_path !== frozen.path || identity.sha256 !== frozen.sha256 || !Array.isArray(artifacts) || !artifacts.length) return false;
  if (realpathSync(artifacts[0].path) !== frozen.path) return false;
  const hashes = readFileSync(within(join(re, 'target/hashes.txt'), re), 'utf8');
  return artifacts.every((item) => {
    const path = realpathSync(item.path);
    if (![frozen.path, frozen.runtime].includes(path) || path !== item.resolved_path || sha(readFileSync(path)) !== item.sha256) return false;
    return item.copy && sha(readFileSync(within(item.copy, re))) === item.sha256 && hashes.includes(`${item.sha256}  ${item.path}`);
  });
}

function corpus(re) {
  const cases = json(within(join(re, 'probes/cases.json'), re));
  const fields = ['id', 'question', 'safe', 'args', 'expect', 'timeout', 'env', 'tty', 'stdin_mode'];
  if (!Array.isArray(cases) || cases.length !== 4 || new Set(cases.map((item) => item?.id)).size !== 4) return null;
  const permittedEnv = { LC_ALL: ['C', 'C.UTF-8'], LANG: ['C', 'C.UTF-8'], TERM: ['dumb'], NO_COLOR: ['1'], CI: ['1'] };
  const valid = cases.every((item) => {
    if (!item || Object.keys(item).some((key) => !fields.includes(key)) || item.safe !== true || !/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(item.id) || typeof item.question !== 'string' || !item.question.trim()) return false;
    if ((item.tty !== undefined && item.tty !== 'none') || (item.stdin_mode !== undefined && item.stdin_mode !== 'null')) return false;
    if (item.timeout !== undefined && (!Number.isFinite(item.timeout) || item.timeout <= 0 || item.timeout > 10)) return false;
    if (item.env !== undefined && (!item.env || Array.isArray(item.env) || Object.entries(item.env).some(([key, value]) => !permittedEnv[key]?.includes(value)))) return false;
    const contract = reContracts.find((entry) => sameArgs(entry.args, item.args));
    if (!contract || !item.expect) return false;
    const expected = { exit_code: contract.code, signal: null, timed_out: false, stdout_sha256: sha(contract.stdout), stderr_sha256: sha(contract.stderr) };
    return Object.keys(item.expect).length === 5 && Object.entries(expected).every(([key, value]) => item.expect[key] === value);
  });
  return valid && reContracts.every((entry) => cases.filter((item) => sameArgs(item.args, entry.args)).length === 1) ? cases : null;
}

function observation(record, re, frozen, cases) {
  const item = cases.find((entry) => entry.id === record.id);
  if (!item || !Array.isArray(record.argv) || realpathSync(record.argv[0]) !== frozen.path || !sameArgs(record.argv.slice(1), item.args) || record.target?.sha256 !== frozen.sha256 || record.target?.realpath !== frozen.path)
    throw new Error('Observation identity or argv mismatch.');
  if (record.capture_complete !== true || record.descendants_hold_output !== false || record.timed_out !== false || record.signal !== null || record.launch_error !== null) throw new Error('Incomplete actual observation.');
  const streams = Object.fromEntries(
    ['stdout', 'stderr'].map((name) => {
      const bytes = readFileSync(within(record[name].path, re));
      if (sha(bytes) !== record[name].sha256 || bytes.length !== record[name].bytes) throw new Error('Raw stream hash mismatch.');
      return [name, bytes.toString('utf8')];
    }),
  );
  const contract = reContracts.find((entry) => sameArgs(entry.args, item.args));
  if (streams.stdout !== contract.stdout || streams.stderr !== contract.stderr || record.exit_code !== contract.code) throw new Error('Recorded observation contradicts literal contract.');
  return { args: item.args, ...streams, code: record.exit_code, signal: null, error: null, id: record.id, stdoutPath: realpathSync(record.stdout.path), stderrPath: realpathSync(record.stderr.path), corpusRun: record.corpus_run };
}

function recordedObservations(re, frozen, cases) {
  const text = readFileSync(within(join(re, 'probes/results.jsonl'), re), 'utf8').trim();
  const records = text ? text.split('\n').map(JSON.parse) : [];
  return records.map((record) => observation(record, re, frozen, cases));
}

function replay(re, frozen, cases, options) {
  const trusted = join(options.repoRoot, 'skills/reverse-engineer-cli/scripts');
  for (const name of ['probe.py', 'investigate.py']) {
    if (sha(readFileSync(within(join(re, 'repro/scripts', name), re))) !== sha(readFileSync(join(trusted, name)))) throw new Error('Copied replay helper differs from trusted source.');
  }
  const result = execute(frozen.runtime, [join(trusted, 'investigate.py'), 'run', '--workspace', re], options);
  writeFileSync(join(options.out, 'replay.txt'), `${result.stdout}\n${result.stderr}`);
  if (result.code !== 0 || result.error || result.signal) return { code: result.code, observations: [], execution: result };
  const summary = JSON.parse(result.stdout);
  if (!/^R-[A-Za-z0-9-]+$/.test(summary.run) || summary.status !== 'PASS' || summary.cases !== 4 || summary.failures.length || summary.unchecked_cases.length) throw new Error('Replay summary is incomplete.');
  const directory = within(join(re, 'probes/runs', summary.run), re);
  if (!sameArgs(json(join(directory, 'cases.json')), cases)) throw new Error('Replay corpus changed.');
  const observations = recordedObservations(re, frozen, cases).filter((record) => record.corpusRun === summary.run);
  return { code: result.code, observations, execution: result, run: summary.run };
}

function localLinks(text, report, re, frozen) {
  const paths = [...text.matchAll(/\[[^\]]*\]\(([^)]+)\)|`([^`]+)`/g)].map((match) => match[1] ?? match[2]);
  return paths.flatMap((path) => {
    try {
      const actual = realpathSync(resolve(dirname(report), path.split('#')[0]));
      return [actual === frozen.path ? actual : within(actual, re)];
    } catch {
      return [];
    }
  });
}

function reportLinks(re, frozen, observations, cases) {
  return ['behavior', 'evidence'].every((name) => {
    const report = within(join(re, 'report', `${name}.md`), re);
    const text = readFileSync(report, 'utf8');
    if (!text.trim() || /Status:\s*NOT INVESTIGATED/i.test(text)) return false;
    const blocks = text.split(/\n\s*\n/);
    return cases.every((item) =>
      observations.some(
        (record) =>
          record.id === item.id &&
          blocks.some((block) => {
            const links = localLinks(block, report, re, frozen);
            return block.includes(item.id) && block.includes(JSON.stringify(item.args)) && links.includes(record.stdoutPath) && links.includes(record.stderrPath);
          }),
      ),
    );
  });
}

function sourceEvidence(re, frozen, cases) {
  const entries = json(within(join(re, 'source/entrypoints.json'), re));
  const entryMatches =
    Array.isArray(entries) &&
    entries.some((entry) => {
      try {
        return realpathSync(entry.path) === frozen.path && entry.sha256 === frozen.sha256;
      } catch {
        return false;
      }
    });
  const tree = json(within(join(re, 'source/command-tree.json'), re));
  const ids = new Set(cases.map((item) => item.id));
  const cited = (node, args) => Array.isArray(node?.evidence) && node.evidence.some((id) => ids.has(id) && sameArgs(cases.find((item) => item.id === id)?.args, args));
  const syntax =
    tree.command === 'greet' &&
    ['--help', '--version'].every((long) => tree.options?.some((option) => option.long === long && cited(option, [long]))) &&
    tree.subcommands?.some((node) => node.command === 'hello' && node.arguments?.some((arg) => arg.name === 'NAME') && cited(node, ['hello', 'Ada'])) &&
    cited(tree, []);
  const report = within(join(re, 'report/architecture.md'), re);
  const text = readFileSync(report, 'utf8');
  return entryMatches && syntax && frozen.source.startsWith('#!/usr/bin/env python3\n') && !/Status:\s*NOT INVESTIGATED/i.test(text) && localLinks(text, report, re, frozen).includes(frozen.path);
}

export function collectReEvidence(options) {
  const { frozen } = options;
  const re = join(options.cwd, '.re');
  const initial = { attemptId: frozen.attemptId, identityMatches: false, observations: [], corpusComplete: false, replayCode: null, replayObservations: [], sourceMatches: false, reportsLinked: false, issues: [] };
  mkdirSync(options.out, { recursive: true });
  let evidence = initial;
  try {
    within(frozen.path, options.cwd);
    if (!unchanged(frozen)) return { ...initial, issues: ['Frozen target or runtime changed before audit.'] };
    const observations = independentlyObserve(frozen, options);
    evidence = { ...initial, observations };
    within(re, options.cwd);
    const identityMatches = workspaceIdentity(re, frozen);
    const cases = corpus(re);
    const partial = { ...initial, identityMatches, observations, corpusComplete: cases !== null };
    evidence = partial;
    if (!identityMatches || !cases) return { ...partial, issues: ['Workspace identity or reviewed bounded corpus incomplete.'] };
    const recorded = recordedObservations(re, frozen, cases);
    const reportsLinked = reportLinks(re, frozen, recorded, cases);
    const sourceMatches = sourceEvidence(re, frozen, cases);
    evidence = { ...partial, reportsLinked, sourceMatches };
    const actual = replay(re, frozen, cases, options);
    const result = { ...partial, reportsLinked, sourceMatches, replayCode: actual.code, replayObservations: actual.observations, replay: actual };
    return { ...result, identityMatches: identityMatches && unchanged(frozen) && workspaceIdentity(re, frozen) };
  } catch (error) {
    return { ...evidence, issues: [error.message] };
  }
}
