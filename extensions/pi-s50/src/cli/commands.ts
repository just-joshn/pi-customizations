import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { piHostCapabilities } from '../adapters/agents.ts';
import { agentBrowserAvailable } from '../adapters/browser.ts';
import { changedPaths, revision } from '../adapters/git.ts';
import { repoFacts } from '../adapters/repo.ts';
import type { RunState } from '../domain/run.ts';
import { CONSUMER_KINDS, type Consumer, type HostCapabilities } from '../domain/run.ts';
import type { Mode } from '../domain/state.ts';
import { routeConsumer } from '../evidence/verification.ts';
import { type Clock, systemClock } from '../orchestrator/clock.ts';
import type { Command, DecisionLog, Outcome } from '../orchestrator/command.ts';
import { apply, applyPreflight, nextAction, startRun } from '../orchestrator/coordinator.ts';
import { decode, parseJson } from '../orchestrator/decode.ts';
import { loadState, readDecisions, readLock, S50_DIR, saveState, writeLock } from '../orchestrator/persistence.ts';
import { classify } from '../orchestrator/routes.ts';
import { capabilities as capabilitiesDecoder, command as commandDecoder } from '../orchestrator/schema.ts';
import { describeAction, renderStatus } from '../orchestrator/status.ts';
import { prReadyBlockers, requiredEvidence } from '../policy/completion.ts';
import { fetchLeaderboard } from '../registry/fetch.ts';
import { buildSnapshot, S50_DEPENDENCIES } from '../registry/lock.ts';
import { parseLeaderboardFile, parseSources, verifySnapshot } from '../registry/validate.ts';

export type CliResult = { readonly code: 0 | 1 | 2; readonly stdout: string };

export type CliContext = { readonly cwd: string; readonly clock: Clock; readonly fetchText: (url: string) => Promise<string> };

const USAGE = `usage: s50 <command>
  feature|bug|frontend <text> [--consumer kind:path] [--criteria a;b] [--capabilities json] [--installed a,b]
  status | verify | resume | explain
  apply '<command json>'
  registry refresh [--from <leaderboard.json>] [--sources <sources.json>] | registry show | registry verify
`;

const SHIPPED_SOURCES = fileURLToPath(new URL('../../registry/skill-sources.json', import.meta.url));

const ok = (stdout: string): CliResult => ({ code: 0, stdout });
const blocked = (stdout: string): CliResult => ({ code: 2, stdout });
const error = (stdout: string): CliResult => ({ code: 1, stdout });

function flags(args: readonly string[]): { readonly positional: readonly string[]; readonly named: ReadonlyMap<string, string> } {
  const positional: string[] = [];
  const named = new Map<string, string>();
  for (let index = 0; index < args.length; index++) {
    const arg = args[index] ?? '';
    if (arg.startsWith('--')) {
      named.set(arg.slice(2), args[index + 1] ?? '');
      index++;
    } else positional.push(arg);
  }
  return { positional, named };
}

async function readJson(path: string) {
  return parseJson(await readFile(path, 'utf8'));
}

function parseConsumer(text: string | undefined): Consumer | string {
  if (text === undefined) return { kind: 'cli', userPath: 'run the command line entry point' };
  const split = text.indexOf(':');
  const kind = CONSUMER_KINDS.find((candidate) => candidate === (split === -1 ? text : text.slice(0, split)));
  if (kind === undefined) return `--consumer kind must be one of ${CONSUMER_KINDS.join('|')}`;
  return { kind, userPath: split === -1 ? '' : text.slice(split + 1) };
}

function parseCapabilities(named: ReadonlyMap<string, string>, browserDriver: boolean): HostCapabilities | string {
  const installedSkills = (named.get('installed') ?? '').split(',').filter((skill) => skill !== '');
  const raw = named.get('capabilities');
  const base = piHostCapabilities({ installedSkills, browserDriver });
  if (raw === undefined) return base;
  const json = parseJson(raw);
  if (json.kind === 'invalid') return `--capabilities: ${json.reason}`;
  const merged = typeof json.value === 'object' && json.value !== null ? { ...base, ...json.value } : json.value;
  const decoded = decode(capabilitiesDecoder, merged);
  return decoded.kind === 'ok' ? decoded.value : `--capabilities: ${decoded.reason}`;
}

function outcomeJson(outcome: Outcome): string {
  if (outcome.kind === 'rejected') return `${JSON.stringify({ kind: 'rejected', reason: outcome.reason, gate: outcome.gate })}\n`;
  const { run } = outcome.state;
  return `${JSON.stringify({ kind: 'ok', phase: run.phase, status: run.status, decisions: outcome.decisions.map((decision) => decision.summary) })}\n`;
}

async function start(context: CliContext, mode: Mode, args: readonly string[]): Promise<CliResult> {
  const dir = join(context.cwd, S50_DIR);
  const { positional, named } = flags(args);
  const objective = positional.join(' ').trim();
  if (objective === '') return error(USAGE);
  if ((await loadState(dir)).kind !== 'missing') return blocked('a run already exists in .s50/; use s50 resume\n');
  const lock = await readLock(dir);
  if (lock === null) return blocked('no .s50/registry.lock.json; run s50 registry refresh first\n');
  if (lock.kind === 'invalid') return error(`invalid registry lock: ${lock.reason}\n`);
  const consumer = parseConsumer(named.get('consumer'));
  if (typeof consumer === 'string') return error(`${consumer}\n`);
  const capabilities = parseCapabilities(named, await agentBrowserAvailable(context.cwd));
  if (typeof capabilities === 'string') return error(`${capabilities}\n`);
  const criteria = (named.get('criteria') ?? objective)
    .split(';')
    .map((item) => item.trim())
    .filter((item) => item !== '');
  const head = await revision(context.cwd);
  let state: RunState = startRun({ mode, objective, repository: context.cwd, revision: head, consumer, acceptanceCriteria: criteria, constraints: [], nonGoals: [], capabilities }, lock.value, context.clock);
  const decisions: DecisionLog[] = [];
  const facts = await repoFacts(context.cwd);
  const steps: ((current: RunState) => Outcome)[] = [
    (current) => apply(current, { kind: 'advance', to: 'PREFLIGHT' }, context.clock),
    (current) => applyPreflight(current, facts, context.clock),
    (current) => apply(current, { kind: 'advance', to: 'CLASSIFY' }, context.clock),
    (current) => apply(current, { kind: 'advance', to: classify(mode) }, context.clock),
  ];
  for (const step of steps) {
    const outcome = step(state);
    if (outcome.kind === 'rejected') break;
    state = outcome.state;
    decisions.push(...outcome.decisions);
  }
  await saveState(dir, null, state, decisions);
  return { code: state.run.status.kind === 'blocked' ? 2 : 0, stdout: renderStatus(state) };
}

async function withState(context: CliContext, body: (state: RunState, dir: string) => Promise<CliResult>): Promise<CliResult> {
  const dir = join(context.cwd, S50_DIR);
  const loaded = await loadState(dir);
  if (loaded.kind === 'missing') return error('no run in .s50/\n');
  if (loaded.kind === 'invalid') return error(`invalid .s50 state: ${loaded.reason}\n`);
  return body(loaded.state, dir);
}

async function applyCommand(context: CliContext, raw: string | undefined): Promise<CliResult> {
  if (raw === undefined) return error(USAGE);
  const json = parseJson(raw);
  if (json.kind === 'invalid') return error(`invalid JSON: ${json.reason}\n`);
  const decoded = decode(commandDecoder, json.value);
  if (decoded.kind === 'invalid') return error(`invalid command: ${decoded.reason}\n`);
  const parsed: Command = decoded.value;
  return withState(context, async (state, dir) => {
    const outcome = apply(state, parsed, context.clock);
    if (outcome.kind === 'rejected') return blocked(outcomeJson(outcome));
    await saveState(dir, state, outcome.state, outcome.decisions);
    return { code: outcome.state.run.status.kind === 'blocked' ? 2 : 0, stdout: outcomeJson(outcome) };
  });
}

async function resume(context: CliContext): Promise<CliResult> {
  return withState(context, async (state, dir) => {
    const head = await revision(context.cwd);
    let next = state;
    const decisions: DecisionLog[] = [];
    if (head !== state.run.currentRevision) {
      const paths = await changedPaths(context.cwd, state.run.currentRevision, head);
      const outcome = apply(state, { kind: 'revision_changed', revision: head, changedPaths: paths }, context.clock);
      if (outcome.kind === 'ok') {
        next = outcome.state;
        decisions.push(...outcome.decisions);
      }
    }
    await saveState(dir, state, next, decisions);
    return ok(`${renderStatus(next)}${JSON.stringify(nextAction(next))}\n`);
  });
}

async function verify(context: CliContext): Promise<CliResult> {
  return withState(context, async (state) => {
    const route = routeConsumer(state.run.consumer.kind, state.run.capabilities);
    const lines = requiredEvidence(state).map((required) => `${required.satisfied ? 'MEASURED' : 'MISSING'} ${required.criterion}`);
    const blockers = state.run.phase === 'PR_READY' ? [] : prReadyBlockers(state);
    const body = [`consumer route: ${route.kind}${route.kind === 'inconclusive' ? ` (${route.missing})` : ''}`, ...lines, ...blockers.map((blocker) => `blocker: ${blocker}`)].join('\n');
    return { code: blockers.length === 0 ? 0 : 2, stdout: `${body}\n` };
  });
}

async function explain(context: CliContext): Promise<CliResult> {
  return withState(context, async (state, dir) => {
    const decisions = await readDecisions(dir);
    if (decisions.kind === 'invalid') return error(`${decisions.reason}\n`);
    const log = decisions.value.slice(-20).map((decision) => `${decision.at} ${decision.phase} ${decision.command}: ${decision.summary}`);
    return ok(`${[...log, `next: ${describeAction(nextAction(state))}`].join('\n')}\n`);
  });
}

async function registry(context: CliContext, args: readonly string[]): Promise<CliResult> {
  const dir = join(context.cwd, S50_DIR);
  const [sub, ...rest] = args;
  if (sub === 'show' || sub === 'verify') {
    const lock = await readLock(dir);
    if (lock === null) return blocked('no registry lock\n');
    if (lock.kind === 'invalid') return error(`invalid registry lock: ${lock.reason}\n`);
    if (sub === 'show') return ok(`${lock.value.skills.map((skill) => `${skill.rank} ${skill.source}/${skill.name} ${skill.invocationPolicy}`).join('\n')}\n`);
    const problems = verifySnapshot(lock.value);
    return problems.length === 0 ? ok('registry lock verified\n') : blocked(`${problems.join('\n')}\n`);
  }
  if (sub !== 'refresh') return error(USAGE);
  const { named } = flags(rest);
  const sourcesPath = named.get('sources');
  const sourcesJson = await readJson(sourcesPath === undefined ? SHIPPED_SOURCES : resolve(context.cwd, sourcesPath));
  if (sourcesJson.kind === 'invalid') return error(`${sourcesJson.reason}\n`);
  const sources = parseSources(sourcesJson.value);
  if (sources.kind === 'invalid') return error(`sources ${sources.reason}\n`);
  const from = named.get('from');
  let leaderboard: Awaited<ReturnType<typeof fetchLeaderboard>>;
  let snapshotTime = context.clock.now();
  let source = 'https://skills.sh/';
  if (from === undefined) leaderboard = await fetchLeaderboard(context.fetchText);
  else {
    const file = await readJson(resolve(context.cwd, from));
    if (file.kind === 'invalid') return error(`${file.reason}\n`);
    const parsed = parseLeaderboardFile(file.value);
    if (parsed.kind === 'invalid') return error(`leaderboard ${parsed.reason}\n`);
    leaderboard = { kind: 'ok', value: parsed.value.entries };
    snapshotTime = parsed.value.fetchedAt;
    source = parsed.value.source;
  }
  if (leaderboard.kind === 'invalid') return error(`leaderboard ${leaderboard.reason}\n`);
  const built = buildSnapshot({ leaderboard: leaderboard.value, sources: sources.value, required: S50_DEPENDENCIES, snapshotTime, source });
  if (built.kind === 'ineligible') return blocked(`ineligible skills outside the top 50: ${built.skills.join(', ')}\n`);
  await writeLock(dir, built.snapshot);
  return ok(`locked ${built.snapshot.skills.length} skills at ${snapshotTime}\n`);
}

const MODE_COMMANDS: Readonly<Record<string, Mode>> = { feature: 'feature', bug: 'bug', frontend: 'frontend' };

export async function runCli(argv: readonly string[], context: CliContext): Promise<CliResult> {
  const [name, ...rest] = argv;
  if (name === undefined) return error(USAGE);
  const mode = MODE_COMMANDS[name];
  if (mode !== undefined) return start(context, mode, rest);
  switch (name) {
    case 'status':
      return withState(context, async (state) => ok(renderStatus(state)));
    case 'verify':
      return verify(context);
    case 'resume':
      return resume(context);
    case 'explain':
      return explain(context);
    case 'apply':
      return applyCommand(context, rest[0]);
    case 'registry':
      return registry(context, rest);
    default:
      return error(USAGE);
  }
}

export function defaultContext(cwd: string): CliContext {
  return {
    cwd,
    clock: systemClock,
    fetchText: async (url) => {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`GET ${url} failed: ${response.status}`);
      return response.text();
    },
  };
}
