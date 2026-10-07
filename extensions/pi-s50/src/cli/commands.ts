import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { piHostCapabilities } from '../adapters/agents.ts';
import { agentBrowserAvailable } from '../adapters/browser.ts';
import { changedPaths, ensureWorktree, remoteHead, revision } from '../adapters/git.ts';
import { repoFacts } from '../adapters/repo.ts';
import { localShell, type Shell } from '../adapters/shell.ts';
import { discoverInstalledSkills, parseInstalled } from '../adapters/skills.ts';
import type { RegistryLock, RegistrySnapshot } from '../domain/registry.ts';
import { CONSUMER_KINDS, type Consumer, type HostCapabilities, type InstalledSkill, type RunState } from '../domain/run.ts';
import type { Mode } from '../domain/state.ts';
import { routeConsumer } from '../evidence/verification.ts';
import { type Clock, systemClock } from '../orchestrator/clock.ts';
import type { Command, DecisionLog, Outcome } from '../orchestrator/command.ts';
import { apply, applyPreflight, nextAction, reconcile, startRun } from '../orchestrator/coordinator.ts';
import { decode, parseJson } from '../orchestrator/decode.ts';
import { loadState, readDecisions, readLock, S50_DIR, saveState, writeLock } from '../orchestrator/persistence.ts';
import { classify } from '../orchestrator/routes.ts';
import { capabilities as capabilitiesDecoder, command as commandDecoder } from '../orchestrator/schema.ts';
import { describeAction, renderStatus } from '../orchestrator/status.ts';
import { prReadyBlockers, requiredEvidence } from '../policy/completion.ts';
import { confirmRankingBasis, fetchLeaderboard, resolveSource, SKILLS_SH_URL } from '../registry/fetch.ts';
import { buildLock, S50_SKILLS } from '../registry/lock.ts';
import { type PinnedSource, parseLeaderboardFile, parseSources, verifySnapshot } from '../registry/validate.ts';
import { canRunConcurrently } from '../scheduler/ownership.ts';

// 0 done, 1 error, 2 refused or a failing check, 3 accepted but the run now waits on a human gate.
export type CliResult = { readonly code: 0 | 1 | 2 | 3; readonly stdout: string };

export type Host = {
  readonly installedSkills: () => Promise<readonly InstalledSkill[]>;
  readonly capabilities: () => Partial<Omit<HostCapabilities, 'installedSkills'>>;
};

export type CliContext = { readonly cwd: string; readonly clock: Clock; readonly fetchText: (url: string) => Promise<string>; readonly shell: Shell; readonly host: Host };

export const SUBCOMMANDS = ['feature', 'bug', 'frontend', 'issue', 'survey', 'status', 'verify', 'resume', 'explain', 'apply', 'registry'] as const;

export const USAGE = `usage: s50 <command>
  feature|bug|frontend <objective> [--consumer kind:path] [--criteria a;b] [--constraints a;b] [--non-goals a;b] [--capabilities json] [--installed a,b]
  issue <issue reference> [same flags]       external issue, explicit /skill:triage first
  survey <area> [same flags]                 architecture survey, explicit /skill:improve-codebase-architecture first
  status | verify | resume | explain
  apply '<command json>'
  registry refresh [--from <leaderboard.json>] [--sources <sources.json>] | registry show | registry verify
`;

const SHIPPED_SOURCES = fileURLToPath(new URL('../../registry/skill-sources.json', import.meta.url));

const MODE_COMMANDS: Readonly<Record<string, Mode>> = { feature: 'feature', bug: 'bug', frontend: 'frontend', issue: 'external_issue', survey: 'architecture_survey' };

const ok = (stdout: string): CliResult => ({ code: 0, stdout });
const refused = (stdout: string): CliResult => ({ code: 2, stdout });
const gated = (state: RunState): 0 | 3 => (state.run.status.kind === 'blocked' ? 3 : 0);
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

const list = (text: string | undefined): readonly string[] =>
  (text ?? '')
    .split(';')
    .map((item) => item.trim())
    .filter((item) => item !== '');

async function readJson(path: string) {
  return parseJson(await readFile(path, 'utf8'));
}

function parseConsumer(text: string | undefined, mode: Mode): Consumer | string {
  if (text === undefined) return mode === 'frontend' ? { kind: 'browser', userPath: 'open the changed page' } : { kind: 'cli', userPath: 'run the command line entry point' };
  const split = text.indexOf(':');
  const kind = CONSUMER_KINDS.find((candidate) => candidate === (split === -1 ? text : text.slice(0, split)));
  if (kind === undefined) return `--consumer kind must be one of ${CONSUMER_KINDS.join('|')}`;
  return { kind, userPath: split === -1 ? '' : text.slice(split + 1) };
}

async function parseCapabilities(context: CliContext, named: ReadonlyMap<string, string>): Promise<HostCapabilities | string> {
  const flagged = named.get('installed');
  const installedSkills = flagged === undefined ? await context.host.installedSkills() : parseInstalled(flagged);
  const base = piHostCapabilities({ browserDriver: await agentBrowserAvailable(context.shell), ...context.host.capabilities(), installedSkills });
  const raw = named.get('capabilities');
  if (raw === undefined) return base;
  const json = parseJson(raw);
  if (json.kind === 'invalid') return `--capabilities: ${json.reason}`;
  const merged = typeof json.value === 'object' && json.value !== null ? { ...base, ...json.value } : json.value;
  const decoded = decode(capabilitiesDecoder, merged);
  return decoded.kind === 'ok' ? decoded.value : `--capabilities: ${decoded.reason}`;
}

function outcomeJson(outcome: Outcome, workspaces: readonly string[] = []): string {
  if (outcome.kind === 'rejected') return `${JSON.stringify({ kind: 'rejected', reason: outcome.reason, gate: outcome.gate })}\n`;
  const { run } = outcome.state;
  const summary = { kind: 'ok', phase: run.phase, status: run.status, decisions: outcome.decisions.map((decision) => decision.summary) };
  return `${JSON.stringify(workspaces.length === 0 ? summary : { ...summary, workspaces })}\n`;
}

type Approved = { readonly kind: 'approved'; readonly snapshot: RegistrySnapshot } | { readonly kind: 'stop'; readonly result: CliResult };

async function approvedLock(dir: string): Promise<Approved> {
  const lock = await readLock(dir);
  if (lock === null) return { kind: 'stop', result: refused('no .s50/registry.lock.json; run s50 registry refresh first\n') };
  if (lock.kind === 'invalid') return { kind: 'stop', result: error(`invalid registry lock: ${lock.reason}\n`) };
  if (lock.value.kind === 'rejected') return { kind: 'stop', result: refused(`${describeLock(lock.value).trim()}; strict mode starts no new run\n`) };
  const problems = verifySnapshot(lock.value.snapshot);
  if (problems.length > 0) return { kind: 'stop', result: refused(`registry lock does not verify: ${problems.join('; ')}\n`) };
  return { kind: 'approved', snapshot: lock.value.snapshot };
}

async function start(context: CliContext, mode: Mode, args: readonly string[]): Promise<CliResult> {
  const dir = join(context.cwd, S50_DIR);
  const { positional, named } = flags(args);
  const objective = positional.join(' ').trim();
  if (objective === '') return error(USAGE);
  if ((await loadState(dir)).kind !== 'missing') return refused('a run already exists in .s50/; use s50 resume\n');
  const approved = await approvedLock(dir);
  if (approved.kind === 'stop') return approved.result;
  const consumer = parseConsumer(named.get('consumer'), mode);
  if (typeof consumer === 'string') return error(`${consumer}\n`);
  const capabilities = await parseCapabilities(context, named);
  if (typeof capabilities === 'string') return error(`${capabilities}\n`);
  const criteria = named.has('criteria') ? list(named.get('criteria')) : [objective];
  const input = {
    mode,
    objective,
    repository: context.cwd,
    revision: await revision(context.shell),
    consumer,
    acceptanceCriteria: criteria,
    constraints: list(named.get('constraints')),
    nonGoals: list(named.get('non-goals')),
    capabilities,
  };
  let state: RunState = startRun(input, approved.snapshot, context.clock);
  const decisions: DecisionLog[] = [];
  const facts = await repoFacts(context.cwd, context.shell);
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
  return { code: gated(state), stdout: renderStatus(state) };
}

async function withState(context: CliContext, body: (state: RunState, dir: string) => Promise<CliResult>): Promise<CliResult> {
  const dir = join(context.cwd, S50_DIR);
  const loaded = await loadState(dir);
  if (loaded.kind === 'missing') return error('no run in .s50/\n');
  if (loaded.kind === 'invalid') return error(`invalid .s50 state: ${loaded.reason}\n`);
  return body(loaded.state, dir);
}

// Git HEAD is the revision truth on every call, so a caller cannot keep evidence current by naming a revision or an empty path list.
async function syncHead(context: CliContext, state: RunState): Promise<{ readonly head: string; readonly state: RunState; readonly decisions: readonly DecisionLog[] }> {
  const head = await revision(context.shell);
  const derived = reconcile(state, context.clock);
  if (head === state.run.currentRevision) return { head, ...derived };
  const paths = await changedPaths(context.shell, state.run.currentRevision, head);
  const outcome = apply(derived.state, { kind: 'revision_changed', revision: head, changedPaths: paths }, context.clock);
  return outcome.kind === 'ok' ? { head, state: outcome.state, decisions: [...derived.decisions, ...outcome.decisions] } : { head, ...derived };
}

async function workspacesFor(context: CliContext, state: RunState): Promise<readonly string[]> {
  const running = state.graph.nodes.filter((node) => node.status === 'running');
  if (!canRunConcurrently(state.run.capabilities)) return [];
  const paths = running.map((node) => `${S50_DIR}/worktrees/${node.id}`);
  for (const [index, node] of running.entries()) await ensureWorktree(context.shell, paths[index] ?? '', `s50/${state.run.id}/${node.id}`);
  return paths;
}

async function applyCommand(context: CliContext, raw: string | undefined): Promise<CliResult> {
  if (raw === undefined) return error(USAGE);
  const json = parseJson(raw);
  if (json.kind === 'invalid') return error(`invalid JSON: ${json.reason}\n`);
  const decoded = decode(commandDecoder, json.value);
  if (decoded.kind === 'invalid') return error(`invalid command: ${decoded.reason}\n`);
  const parsed: Command = decoded.value;
  return withState(context, async (state, dir) => {
    const synced = await syncHead(context, state);
    if ((parsed.kind === 'integrate_node' || parsed.kind === 'revision_changed') && parsed.revision !== synced.head) {
      await saveState(dir, state, synced.state, synced.decisions);
      return refused(`${JSON.stringify({ kind: 'rejected', reason: `${parsed.kind} names ${parsed.revision}, but HEAD is ${synced.head}`, gate: null })}\n`);
    }
    const outcome = apply(synced.state, parsed, context.clock);
    if (outcome.kind === 'rejected') {
      await saveState(dir, state, synced.state, synced.decisions);
      return refused(outcomeJson(outcome));
    }
    const workspaces = parsed.kind === 'start_nodes' ? await workspacesFor(context, outcome.state) : [];
    await saveState(dir, state, outcome.state, [...synced.decisions, ...outcome.decisions]);
    return { code: gated(outcome.state), stdout: outcomeJson(outcome, workspaces) };
  });
}

// Every reader sees the run at git HEAD, so a commit after the last command cannot leave stale evidence looking current.
async function withSyncedState(context: CliContext, body: (state: RunState, dir: string) => Promise<CliResult>): Promise<CliResult> {
  return withState(context, async (state, dir) => {
    const synced = await syncHead(context, state);
    await saveState(dir, state, synced.state, synced.decisions);
    return body(synced.state, dir);
  });
}

async function resume(context: CliContext): Promise<CliResult> {
  return withSyncedState(context, async (state) => ok(`${renderStatus(state)}${JSON.stringify(nextAction(state))}\n`));
}

async function verify(context: CliContext): Promise<CliResult> {
  return withSyncedState(context, async (state) => {
    const route = routeConsumer(state.run.consumer.kind, state.run.capabilities);
    const lines = requiredEvidence(state).map((required) => `${required.satisfied ? 'MEASURED' : 'MISSING'} ${required.criterion}`);
    const blockers = prReadyBlockers(state);
    const body = [`consumer route: ${route.kind}${route.kind === 'inconclusive' ? ` (${route.missing})` : ''}`, ...lines, ...blockers.map((blocker) => `blocker: ${blocker}`)].join('\n');
    return { code: blockers.length === 0 ? 0 : 2, stdout: `${body}\n` };
  });
}

async function explain(context: CliContext): Promise<CliResult> {
  return withSyncedState(context, async (state, dir) => {
    const decisions = await readDecisions(dir);
    if (decisions.kind === 'invalid') return error(`${decisions.reason}\n`);
    const log = decisions.value.slice(-20).map((decision) => `${decision.at} ${decision.phase} ${decision.command}: ${decision.summary}`);
    return ok(`${[...log, `next: ${describeAction(nextAction(state))}`].join('\n')}\n`);
  });
}

function describeLock(lock: RegistryLock): string {
  if (lock.kind === 'rejected') return `registry refresh at ${lock.checkedAt} failed closed: ${lock.ineligible.join(', ')}\n`;
  const rows = lock.snapshot.skills
    .toSorted((a, b) => a.rank - b.rank)
    .map((skill) => `${skill.rank} ${skill.source}/${skill.name} ${skill.invocationPolicy} ${skill.lock.kind === 'git_commit' ? skill.lock.commit.slice(0, 7) : skill.lock.contentHash}`);
  return `snapshot ${lock.snapshot.snapshotTime} from ${lock.snapshot.source}\n${rows.join('\n')}\n`;
}

async function liveSources(context: CliContext, pins: Readonly<Record<string, PinnedSource>>): Promise<Readonly<Record<string, PinnedSource>> | string> {
  const heads = new Map<string, Promise<string>>();
  const head = (repository: string): Promise<string> => {
    const cached = heads.get(repository) ?? remoteHead(context.shell, repository);
    heads.set(repository, cached);
    return cached;
  };
  const resolved: Record<string, PinnedSource> = {};
  for (const name of S50_SKILLS) {
    const pin = pins[name];
    if (pin === undefined) continue;
    const source = await resolveSource(name, pin, { fetchText: context.fetchText, head });
    if (source.kind === 'invalid') return source.reason;
    resolved[name] = source.value;
  }
  return resolved;
}

async function refresh(context: CliContext, dir: string, named: ReadonlyMap<string, string>): Promise<CliResult> {
  const sourcesPath = named.get('sources');
  const sourcesJson = await readJson(sourcesPath === undefined ? SHIPPED_SOURCES : resolve(context.cwd, sourcesPath));
  if (sourcesJson.kind === 'invalid') return error(`${sourcesJson.reason}\n`);
  const pins = parseSources(sourcesJson.value);
  if (pins.kind === 'invalid') return error(`sources ${pins.reason}\n`);
  const from = named.get('from');
  let built: ReturnType<typeof buildLock>;
  if (from === undefined) {
    const basis = await confirmRankingBasis(context.fetchText);
    if (basis.kind === 'invalid') return error(`${basis.reason}\n`);
    const leaderboard = await fetchLeaderboard(context.fetchText);
    if (leaderboard.kind === 'invalid') return error(`leaderboard ${leaderboard.reason}\n`);
    const sources = await liveSources(context, pins.value);
    if (typeof sources === 'string') return error(`source ${sources}\n`);
    built = buildLock({ leaderboard: leaderboard.value, sources, snapshotTime: context.clock.now(), source: SKILLS_SH_URL });
  } else {
    const file = await readJson(resolve(context.cwd, from));
    if (file.kind === 'invalid') return error(`${file.reason}\n`);
    const parsed = parseLeaderboardFile(file.value);
    if (parsed.kind === 'invalid') return error(`leaderboard ${parsed.reason}\n`);
    built = buildLock({ leaderboard: parsed.value.entries, sources: pins.value, snapshotTime: parsed.value.fetchedAt, source: parsed.value.source });
  }
  await writeLock(dir, built.lock);
  if (built.lock.kind === 'rejected') return refused(`ineligible required skills outside the top 50: ${built.lock.ineligible.join(', ')}; strict mode starts no new run\n`);
  const dropped = built.dropped.length === 0 ? '' : `; dropped optional ${built.dropped.join(', ')}`;
  return ok(`locked ${built.lock.snapshot.skills.length} skills at ${built.lock.snapshot.snapshotTime}${dropped}\n`);
}

async function registry(context: CliContext, args: readonly string[]): Promise<CliResult> {
  const dir = join(context.cwd, S50_DIR);
  const [sub, ...rest] = args;
  if (sub === 'refresh') return refresh(context, dir, flags(rest).named);
  if (sub !== 'show' && sub !== 'verify') return error(USAGE);
  const lock = await readLock(dir);
  if (lock === null) return refused('no registry lock\n');
  if (lock.kind === 'invalid') return error(`invalid registry lock: ${lock.reason}\n`);
  if (lock.value.kind === 'rejected') return refused(describeLock(lock.value));
  if (sub === 'show') return ok(describeLock(lock.value));
  const problems = verifySnapshot(lock.value.snapshot);
  return problems.length === 0 ? ok('registry lock verified\n') : refused(`${problems.join('\n')}\n`);
}

export async function runCli(argv: readonly string[], context: CliContext): Promise<CliResult> {
  const [name, ...rest] = argv;
  const mode = MODE_COMMANDS[name ?? ''];
  if (mode !== undefined) return start(context, mode, rest);
  switch (name) {
    case 'status':
      return withSyncedState(context, async (state) => ok(renderStatus(state)));
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

export function defaultContext(cwd: string, signal: AbortSignal | undefined, host: Host = { installedSkills: () => discoverInstalledSkills(cwd), capabilities: () => ({}) }): CliContext {
  return {
    cwd,
    clock: systemClock,
    shell: localShell(cwd, signal),
    host,
    fetchText: async (url) => {
      const response = await fetch(url, signal === undefined ? {} : { signal });
      if (!response.ok) throw new Error(`GET ${url} failed: ${response.status}`);
      return response.text();
    },
  };
}
