// The two checks vendor setup-benny SKILL.md asks of setup, run without posting to a real workspace.
//
// `checkConnectors` is section 4, "Check integration capabilities": the Slack connector, the tracker, and the repository
// are reached with read-only calls, so a missing scope or label shows up before the first report does.
//
// `threadSafetyCheck` is section 8, "Test thread safety": the seven checks against a harmless test report, run through
// the real parent code (event adapter, dispatch, outbox, tracker policy, reproduce handoff) with an in-memory Slack thread,
// an in-memory tracker, and a recording spawn, never a workspace. It uses the project's own configuration, so a changed
// marker, channel, or label is the one under test.
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { type AutomationConfig, createAutomation } from '../../adapters/automation-events.ts';
import type { BennyConfig } from './configuration.ts';
import { credentialsDir } from './credentials.ts';
import { AUTOMATION_CAPABILITIES, type TrackerAction } from './model.ts';
import type { ThreadDestination, ThreadMessage, TrackerDestination } from './outbox.ts';
import { adapterSkillProblem } from './tracker-adapter.ts';
import { type GhExec, githubTracker } from './tracker-github.ts';
import { createTrackerPolicy } from './tracker-policy.ts';
import type { SkillLocations } from './skills.ts';

export interface Check {
  name: string;
  ok: boolean;
  detail: string;
}

export interface ConnectorDeps {
  fetch: typeof fetch;
  /** The Slack connector's token, or the reason it cannot be read. */
  slack: { ok: true; token: string } | { ok: false; reason: string };
  baseUrl?: string;
  exec: GhExec;
  locations?: Omit<SkillLocations, 'projectRoot'>;
}

const SLACK_WRITE_SCOPES = ['chat:write'];
const SLACK_FILE_SCOPES = ['files:read'];
const SLACK_HISTORY_SCOPES = ['channels:history', 'groups:history'];

async function slackCall(deps: ConnectorDeps & { slack: { ok: true; token: string } }, method: string, body: Record<string, unknown>) {
  const response = await deps.fetch(new URL(method, deps.baseUrl ?? 'https://slack.com/api/'), { method: 'POST', headers: { authorization: `Bearer ${deps.slack.token}`, 'content-type': 'application/json; charset=utf-8' }, body: JSON.stringify(body) });
  const result = (await response.json()) as { ok?: boolean; error?: string; channel?: { is_member?: boolean } };
  return { ok: response.ok && result.ok === true, error: result.error ?? `HTTP ${response.status}`, scopes: response.headers.get('x-oauth-scopes'), channel: result.channel };
}

/** Read-only calls, in the order the setup skill lists them. A check that cannot run says why, and nothing is posted. */
export async function checkConnectors(config: BennyConfig, deps: ConnectorDeps): Promise<Check[]> {
  const checks: Check[] = [];
  const add = (name: string, problem: string | undefined, detail = 'ok') => checks.push({ name, ok: problem === undefined, detail: problem ?? detail });

  if (!deps.slack.ok) add('slack connector', `the Slack connector credential is ${deps.slack.reason}; Benny posts only through it`);
  else {
    const slack = { ...deps, slack: deps.slack };
    const auth = await slackCall(slack, 'auth.test', {}).catch((error: unknown) => ({ ok: false, error: error instanceof Error ? error.message : String(error), scopes: null, channel: undefined }));
    add('slack connector', auth.ok ? undefined : `auth.test failed: ${auth.error}`, 'the token is valid');
    if (auth.ok) {
      const granted = auth.scopes === null ? undefined : auth.scopes.split(',').map((scope) => scope.trim());
      const missing = granted === undefined ? [] : [...SLACK_WRITE_SCOPES, ...SLACK_FILE_SCOPES].filter((scope) => !granted.includes(scope)).concat(SLACK_HISTORY_SCOPES.some((scope) => granted.includes(scope)) ? [] : [SLACK_HISTORY_SCOPES.join(' or ')]);
      add('slack scopes', missing.length > 0 ? `the token lacks ${missing.join(', ')}` : undefined, granted === undefined ? 'Slack reported no scopes, so they were not checked' : `has ${[...SLACK_WRITE_SCOPES, ...SLACK_FILE_SCOPES].join(', ')} and thread history`);
      for (const [name, channel] of [['source channel', config.sourceChannelId], ...(config.operations === undefined ? [] : [['operations channel', config.operations.channelId]])] as const) {
        const info = await slackCall(slack, 'conversations.info', { channel }).catch((error: unknown) => ({ ok: false, error: error instanceof Error ? error.message : String(error), scopes: null, channel: undefined }));
        add(name, !info.ok ? `conversations.info ${channel} failed: ${info.error}` : info.channel?.is_member === false ? `the bot is not a member of ${channel}` : undefined, `${channel} is readable and the bot is in it`);
      }
    }
  }

  if (config.tracker.type === 'github' && config.tracker.repo !== undefined) {
    const tracker = githubTracker({ exec: deps.exec, repo: config.tracker.repo });
    const reachable = await tracker.reachable();
    add('tracker', reachable ? undefined : `gh cannot reach ${config.tracker.repo}; run \`gh auth login\` as the user that runs the automation`, `gh reaches ${config.tracker.repo}`);
    if (reachable) {
      const labels = (await deps.exec(['api', '--paginate', `repos/${config.tracker.repo}/labels`, '--jq', '.[].name']).catch(() => '')).split('\n').map((label) => label.trim());
      const wanted = Object.values(config.tracker.labels);
      const absent = wanted.filter((label) => !labels.includes(label));
      add('tracker labels', absent.length > 0 ? `${config.tracker.repo} has no label ${absent.join(', ')}, and the adapter never creates one` : undefined, 'the four configured labels exist');
    }
  } else add('tracker', adapterSkillProblem(config.tracker, config.projectRoot, deps.locations), `the adapter skill ${config.tracker.adapterSkillName} resolves`);

  const repository = /^https:\/\/github\.com\/([^/]+\/[^/]+?)(?:\.git)?\/?$/.exec(config.repositoryUrl)?.[1];
  if (repository === undefined) checks.push({ name: 'repository', ok: true, detail: `${config.repositoryUrl} is not a github.com repository, so draft pull request access was not checked` });
  else add('repository', (await deps.exec(['api', `repos/${repository}`, '--jq', '.full_name']).catch(() => '')).trim() === repository ? undefined : `gh cannot reach ${repository}, so a draft pull request cannot be opened`, `gh reaches ${repository}`);
  return checks;
}

const ROOT_TS = '1700000000.000100';

/**
 * The seven checks of setup-benny section 8 on a harmless test report. Every external edge is in memory: the thread, the
 * tracker, and the worker spawn. The first failed check is named, and the rest still run.
 */
export async function threadSafetyCheck(config: BennyConfig): Promise<{ ok: boolean; checks: Check[] }> {
  const project = mkdtempSync(join(tmpdir(), 'benny-setup-check-'));
  const checks: Check[] = [];
  const check = (name: string, problem: string | undefined, detail = 'ok') => checks.push({ name, ok: problem === undefined, detail: problem ?? detail });
  try {
    const identity = config.triageIdentityUserId ?? 'UTRIAGE';
    const channel = config.sourceChannelId;
    const thread: ThreadMessage[] = [{ ts: ROOT_TS, user: 'UREPORTER', text: 'benny setup check: harmless test report' }];
    const posts: { channel: string; threadTs: string; text: string }[] = [];
    const issues: TrackerAction[] = [];
    const destination: ThreadDestination = {
      readThread: async () => [...thread],
      post: async (action) => {
        posts.push({ channel: action.channel, threadTs: action.threadTs, text: action.text });
        const ts = `1700000001.${String(thread.length).padStart(6, '0')}`;
        thread.push({ ts, marker: action.id, user: identity, text: action.text });
        return { ts };
      },
    };
    const tracker: TrackerDestination = {
      searchByMarker: async (marker) => issues.filter((issue) => issue.id === marker).map(() => ({ id: String(issues.length) })),
      create: async (action) => (issues.push(action), { id: String(issues.length) }),
      update: async (action) => (issues.push(action), { id: action.targetId ?? '' }),
      comment: async (action) => (issues.push(action), { id: action.targetId ?? '' }),
      compensate: async (action) => ({ id: action.targetId ?? '' }),
    };
    const spawned: string[] = [];
    const base = { sourceChannelId: channel, triageIdentityUserId: identity, projectRoot: project, ...(config.trackerAttribute === undefined ? {} : { trackerAttribute: config.trackerAttribute }), tracker: config.tracker };
    const triageConfig: AutomationConfig = { ...base, name: 'setup-check-triage', kind: 'triage' };
    const reproConfig: AutomationConfig = { ...base, name: 'setup-check-reproduce', kind: 'reproduce' };
    const deps = {
      spawnWorker: async (_runId: string, assignmentPath: string) => void spawned.push(assignmentPath),
      destination,
      prerequisites: { tracker: async () => true, controlAdapter: async () => true, featureMap: async () => true },
      tracker,
      trackerPolicy: createTrackerPolicy({ tracker: config.tracker, destination, canCompensate: true }),
      trackerUrl: (id: string) => `https://setup.check/issues/${id}`,
      inputCommit: () => '0'.repeat(40),
    };
    const event = { source_channel_id: channel, ts: ROOT_TS, text: 'benny setup check: harmless test report' };

    const triage = createAutomation(triageConfig, deps);
    const run = await triage.handle(event);
    if (run.status !== 'dispatched') {
      check('1 root thread_ts and one verdict reply', `the test report was not dispatched (${run.status})`);
      return { ok: false, checks };
    }
    await triage.complete(run.runId, { text: 'Setup check only: a harmless test report.\n[benny:bug]', tracker: { operation: 'create', title: 'Benny setup check', body: 'A harmless test report.' } });
    await triage.complete(run.runId, { text: 'Setup check only: a harmless test report.\n[benny:bug]', tracker: { operation: 'create', title: 'Benny setup check', body: 'A harmless test report.' } });
    const verdict = posts[0];
    check('1 root thread_ts and one verdict reply', posts.length === 1 && verdict?.threadTs === ROOT_TS && verdict.channel === channel && issues.length === 1 ? undefined : `expected one reply under ${ROOT_TS} and one issue, got ${posts.length} reply(ies) and ${issues.length} issue(s)`, `one reply under ${ROOT_TS}, and a repeated completion changed nothing`);
    const lastLine = verdict?.text.trimEnd().split('\n').at(-1) ?? '';
    const markers = ['[benny:bug]', '[benny:performance]', '[benny:other]'].filter((marker) => verdict?.text.includes(marker));
    check('2 one configured marker', markers.length === 1 && lastLine.startsWith(markers[0] as string) ? undefined : `the verdict carries ${markers.length} markers, or not on its last line`, `the verdict ends with ${lastLine}`);

    const repro = createAutomation(reproConfig, deps);
    const trusted = await repro.handle({ ...event, ts: ROOT_TS });
    const stranger = createAutomation({ ...reproConfig, name: 'setup-check-reproduce-2', triageIdentityUserId: 'UNOTTHETRIAGEIDENTITY' }, deps);
    const refused = await stranger.handle({ ...event, ts: ROOT_TS });
    check('3 marker trusted only from the triage identity', trusted.status === 'dispatched' && refused.status === 'rejected' ? undefined : `the configured identity gave ${trusted.status}, another identity gave ${refused.status}`, `accepted from ${identity}, refused from anyone else`);

    const [assignmentPath] = spawned.slice(-1);
    const workerFiles = assignmentPath === undefined ? [] : [assignmentPath, join(dirname(assignmentPath), 'brief.md')];
    const brief = workerFiles.length === 0 ? '' : readFileSync(join(dirname(assignmentPath as string), 'brief.md'), 'utf8');
    check('4 immutable source coordinates', brief.includes(`source_channel_id: \`${channel}\``) && brief.includes(`root thread ts: \`${ROOT_TS}\``) ? undefined : 'the reproduce brief does not carry the source channel and root ts', 'the reproduce brief carries the same channel and root ts');
    check('5 no source-channel root message', posts.every((post) => post.threadTs !== '' && post.channel === channel) ? undefined : 'a post had no thread_ts', `every post is a reply (${posts.length} post(s))`);
    const assignment = workerFiles.length === 0 ? {} : (JSON.parse(readFileSync(workerFiles[0] as string, 'utf8')) as { capabilities?: unknown });
    const handedToWorker = `${workerFiles[0] === undefined ? '' : readFileSync(workerFiles[0], 'utf8')}\n${brief}`;
    check('6 a worker has no Slack write', JSON.stringify(assignment.capabilities) === JSON.stringify(AUTOMATION_CAPABILITIES) && !handedToWorker.includes(credentialsDir()) ? undefined : 'a worker assignment grants more than the automation capabilities, or names the credentials directory', 'workers get mcp none, env minimal, externalWrite false, and no credential path');

    const before = { posts: posts.length, issues: issues.length };
    const bad = await triage.handle({ source_channel_id: channel, text: 'no coordinates' });
    const orphan = await triage.handle({ ...event, ts: '1700000002.000100' });
    if (orphan.status === 'dispatched') {
      // Its root was never in the thread, which is what a deleted parent looks like to the parent adapter.
      await triage.complete(orphan.runId, { text: 'Orphan.\n[benny:bug]', tracker: { operation: 'create', title: 'Orphan', body: 'x' } });
    }
    check('7 missing coordinates or a deleted parent post and write nothing', bad.status === 'rejected' && posts.length === before.posts && issues.length === before.issues ? undefined : `a report without coordinates gave ${bad.status}; posts ${before.posts} to ${posts.length}, issues ${before.issues} to ${issues.length}`, 'no post and no tracker issue');
    return { ok: checks.every((entry) => entry.ok), checks };
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
}
