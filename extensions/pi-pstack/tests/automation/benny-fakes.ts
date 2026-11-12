// Fakes for the two external edges of the Benny serve process: Slack's HTTP API and the `gh` CLI. Both keep state, so a
// test can assert what the destination holds after a crash and a restart, not only which calls were made.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

import type { BennyConfig } from '../../src/automation/configuration.ts';
import { workerDir } from '../../src/automation/dispatch.ts';
import type { RunId } from '../../src/automation/model.ts';
import { loadBennyConfig } from '../../src/automation/configuration.ts';
import type { GhExec } from '../../src/automation/tracker-github.ts';
import type { WiringDeps } from '../../src/automation/wiring.ts';

export const CHANNEL = 'CSOURCE01';
export const TRIAGE_USER = 'UTRIAGE01';
export const REPO = 'acme/app';
export const ROOT_TS = '1762900000.000100';
export const REPORT = { source_channel_id: CHANNEL, ts: ROOT_TS, user: 'U123', text: 'Export button does nothing on Safari' };

interface SlackMessage {
  ts: string;
  user?: string;
  text: string;
  metadata?: unknown;
}

export const OPS_CHANNEL = 'COPS00001';

interface OpsMessage extends SlackMessage {
  thread_ts?: string;
}

/**
 * Slack's HTTP API for the source channel and an operations channel. `dropAck` makes the next call of a method land and
 * then answer with an error, which is what a crash between a write and its acknowledgement looks like to the parent.
 */
export function fakeSlack(options: { failPosts?: number } = {}) {
  /** Files by their private download url, and every request made for one with the Authorization header it carried. */
  const files = new Map<string, { bytes: Uint8Array | string; contentType: string; status?: number }>();
  const downloads: { url: string; authorization: string | null; redirect?: string }[] = [];
  const messages: SlackMessage[] = [{ ts: ROOT_TS, user: 'U123', text: REPORT.text }];
  const posts: { thread_ts: string; text: string }[] = [];
  const ops: OpsMessage[] = [];
  const calls: string[] = [];
  const opsEdits: { ts: string; text: string }[] = [];
  const dropAck = new Set<string>();
  const state = { opsDown: false };
  let failPosts = options.failPosts ?? 0;
  const fetchFake: typeof fetch = async (input, init) => {
    if (init?.method !== 'POST') {
      const url = String(input);
      downloads.push({ url, authorization: new Headers(init?.headers).get('authorization'), ...(init?.redirect === undefined ? {} : { redirect: init.redirect }) });
      const file = files.get(url);
      if (file === undefined) return new Response('not found', { status: 404 });
      return new Response(file.bytes as ConstructorParameters<typeof Response>[0], { status: file.status ?? 200, headers: { 'content-type': file.contentType } });
    }
    const method = new URL(String(input)).pathname.split('/').at(-1) as string;
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    const reply = (value: Record<string, unknown>) => new Response(JSON.stringify({ ok: true, ...value }));
    const toOps = body['channel'] === OPS_CHANNEL;
    calls.push(`${method}${toOps ? ':ops' : ''}`);
    if (toOps && state.opsDown) return new Response(JSON.stringify({ ok: false, error: 'channel_not_found' }));
    const landedButLost = () => dropAck.delete(method) && new Response(JSON.stringify({ ok: false, error: 'internal_error' }));
    if (method === 'conversations.replies') {
      if (toOps) return reply({ messages: ops.filter((message) => message.ts === body['ts'] || message.thread_ts === body['ts']) });
      return reply({ messages: messages.filter((message) => message.ts === ROOT_TS || message.ts > ROOT_TS) });
    }
    if (method === 'conversations.history') {
      const roots = ops.filter((message) => message.thread_ts === undefined && (body['latest'] === undefined || message.ts <= String(body['latest'])) && (body['oldest'] === undefined || message.ts >= String(body['oldest']))).reverse();
      return reply({ messages: roots.slice(0, Number(body['limit'] ?? 100)) });
    }
    if (method === 'chat.update') {
      const message = ops.find((candidate) => candidate.ts === body['ts']);
      if (message === undefined) return new Response(JSON.stringify({ ok: false, error: 'message_not_found' }));
      message.text = String(body['text']);
      message.metadata = body['metadata'];
      opsEdits.push({ ts: message.ts, text: message.text });
      return landedButLost() || reply({ ts: message.ts });
    }
    if (method === 'chat.postMessage') {
      if (failPosts > 0) {
        failPosts -= 1;
        return new Response(JSON.stringify({ ok: false, error: 'ratelimited' }));
      }
      if (toOps) {
        const ts = `1762900100.${String(ops.length).padStart(6, '0')}`;
        ops.push({ ts, user: TRIAGE_USER, text: String(body['text']), metadata: body['metadata'], ...(typeof body['thread_ts'] === 'string' ? { thread_ts: body['thread_ts'] } : {}) });
        return landedButLost() || reply({ ts });
      }
      posts.push({ thread_ts: String(body['thread_ts']), text: String(body['text']) });
      const ts = `1762900001.${String(messages.length).padStart(6, '0')}`;
      messages.push({ ts, user: TRIAGE_USER, text: String(body['text']), metadata: body['metadata'] });
      return reply({ ts });
    }
    return new Response(JSON.stringify({ ok: false, error: `unexpected ${method}` }));
  };
  return { messages, posts, ops, opsEdits, calls, dropAck, state, files, downloads, fetch: fetchFake };
}

interface Issue {
  number: number;
  state: 'open' | 'closed';
  title: string;
  body: string;
  labels: string[];
  comments: { id: number; body: string }[];
}

/** A GitHub repository behind the `gh api` calls the adapter makes. Anything else fails, so a stray call is a test failure. */
export function fakeGh(seed: Pick<Issue, 'title' | 'body' | 'state'>[] = []) {
  const issues: Issue[] = seed.map((issue, index) => ({ ...issue, number: index + 1, labels: [], comments: [] }));
  const calls: string[][] = [];
  const exec: GhExec = async (args) => {
    calls.push(args);
    const field = (name: string) => args.flatMap((arg, index) => (args[index - 1] === '-f' && arg.startsWith(`${name}=`) ? [arg.slice(name.length + 1)] : []))[0] ?? '';
    const path = args.find((arg) => arg.startsWith('repos/')) ?? '';
    const jq = args[args.indexOf('--jq') + 1] ?? '';
    const write = args.includes('POST') || args.includes('PATCH');
    if (path === `repos/${REPO}`) return `${REPO}\n`;
    if (path === `repos/${REPO}/issues` && !write) return issues.map(({ number, state, title, body }) => JSON.stringify({ number, state, title, body })).join('\n');
    if (path === `repos/${REPO}/issues/comments`) return issues.flatMap((issue) => issue.comments.map((comment) => JSON.stringify({ issue_url: `https://api.github.com/repos/${REPO}/issues/${issue.number}`, body: comment.body }))).join('\n');
    if (path === `repos/${REPO}/issues` && args.includes('POST')) {
      const issue: Issue = { number: issues.length + 1, state: 'open', title: field('title'), body: field('body'), labels: args.filter((arg) => arg.startsWith('labels[]=')).map((arg) => arg.slice(9)), comments: [] };
      issues.push(issue);
      return `${issue.number}\n`;
    }
    const match = /^repos\/[^/]+\/[^/]+\/issues\/(\d+)(\/comments)?$/.exec(path);
    const issue = match === null ? undefined : issues.find((candidate) => candidate.number === Number(match[1]));
    if (issue === undefined) throw new Error(`gh: not found ${path}`);
    if (match?.[2] !== undefined) {
      issue.comments.push({ id: issue.comments.length + 1, body: field('body') });
      return '1\n';
    }
    if (args.includes('PATCH')) {
      if (field('body') !== '') issue.body = field('body');
      if (field('state') === 'closed') issue.state = 'closed';
      return `${issue.number}\n`;
    }
    return jq.startsWith('.body') ? `${issue.body}\n` : `${JSON.stringify({ number: issue.number, state: issue.state, title: issue.title, pull_request: false })}\n`;
  };
  return { issues, calls, exec };
}

const FEATURE_MAP = `# Feature map

### Export

Lets a user export a report.

#### How a user gets there

- Reports, then Export.

#### How the control adapter drives it

- click Export should download a file.
`;

const stateFile = (dir: string, runId: RunId) => join(workerDir(dir, runId), 'state.json');
const readState = (dir: string, runId: RunId): { generation: number } | undefined => (existsSync(stateFile(dir, runId)) ? (JSON.parse(readFileSync(stateFile(dir, runId), 'utf8')) as { generation: number }) : undefined);

/**
 * Writes what a host leaves behind: its state file and the native session file with the worker's last message. A settle
 * covers the host's current generation unless `unsettled` says the host holds work no settle covers yet, which is what a
 * host looks like between a message it took and the end of that turn. The pid is this process's, so that state reads as
 * running rather than as a host that died.
 */
export function settleWorker(dir: string, runId: RunId, outcome: { phase: 'idle' | 'failed' | 'aborted'; reason?: string; finalText?: string; generation?: number; unsettled?: boolean }, workerId = 'owner') {
  const worker = workerDir(dir, runId);
  const sessionFile = join(worker, 'session', 'fake.jsonl');
  mkdirSync(join(worker, 'session'), { recursive: true });
  if (outcome.finalText !== undefined || !existsSync(sessionFile)) {
    const message = outcome.finalText === undefined ? '' : `${JSON.stringify({ type: 'message', message: { role: 'assistant', content: [{ type: 'text', text: outcome.finalText }] } })}\n`;
    writeFileSync(sessionFile, message);
  }
  const generation = outcome.generation ?? readState(dir, runId)?.generation ?? 1;
  const settles = outcome.unsettled === true ? [] : [{ sequence: generation, generation, phase: outcome.phase, reason: outcome.reason ?? null, at: new Date().toISOString() }];
  const state = { schemaVersion: 1, runId, workerId, kind: 'pi', digest: 'x', instance: 'i1', hostPid: outcome.unsettled === true ? process.pid : 2 ** 22 - 1, childPid: null, tmuxSession: 's', socketPath: '/nonexistent', phase: outcome.unsettled === true ? 'running' : 'idle', reason: null, model: null, sessionFile, briefSent: true, generation, settles, exit: null, updatedAt: new Date().toISOString() };
  writeFileSync(stateFile(dir, runId), JSON.stringify(state));
}

/** The host takes one more message: its generation moves up and nothing settles it until `settleWorker` does. */
export function beginTurn(dir: string, runId: RunId): number {
  const generation = (readState(dir, runId)?.generation ?? 1) + 1;
  settleWorker(dir, runId, { phase: 'idle', generation, unsettled: true });
  return generation;
}

export interface BennyProject {
  dir: string;
  config: (kind: 'triage' | 'reproduce') => BennyConfig;
}

/** A project with a loadable Benny configuration, a valid feature map, and the GitHub tracker selected. */
export function bennyProject(options: { featureMap?: string | null; controlSkill?: string; root?: string; adapterSkill?: string | null; operationsChannel?: string } = {}): BennyProject {
  const dir = options.root ?? realpathSync(mkdtempSync(join(tmpdir(), 'benny-e2e-')));
  const template = readFileSync(resolve('generated/automations/benny/templates/configuration.example.yaml'), 'utf8')
    .replace('SOURCE_CHANNEL_ID', CHANNEL)
    .replace('TRIAGE_IDENTITY_USER_ID', TRIAGE_USER)
    .replace(/  type: "linear"[\s\S]*?  status: "intake-status-placeholder"\n/, (block) => (options.adapterSkill === undefined ? `  type: "github"\n  repo: "${REPO}"\n  labels:\n    bug: "bug"\n    performance: "performance"\n    intake: "intake"\n    needs_repro: "needs-repro"\n` : block.replace('issue-tracker-adapter-placeholder', options.adapterSkill ?? 'issue-tracker-adapter-placeholder')))
    .replace('operations_channel_id: ""', `operations_channel_id: "${options.operationsChannel ?? ''}"`)
    .replaceAll('choose-an-available-public-model-slug', 'inherit-parent')
    .replace(/^  skill_name: ".*"/m, `  skill_name: "${options.controlSkill ?? 'control-ui'}"`);
  const file = join(dir, '.pi/benny/configuration.yaml');
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, template);
  if (typeof options.adapterSkill === 'string') {
    mkdirSync(join(dir, '.pi/skills', options.adapterSkill), { recursive: true });
    writeFileSync(join(dir, '.pi/skills', options.adapterSkill, 'SKILL.md'), `---\nname: ${options.adapterSkill}\ndescription: Reads and writes the team's Linear issues through the Linear MCP tools.\n---\n\nUse the Linear MCP tools. Search issues by text, create, update, comment, and cancel.\n`);
  }
  if (options.featureMap !== null) writeFileSync(join(dir, '.pi/benny/feature-map.md'), options.featureMap ?? FEATURE_MAP);
  return { dir, config: (kind) => loadBennyConfig(dir, kind, file) };
}

export const wiringDeps = (slack: ReturnType<typeof fakeSlack>, gh: ReturnType<typeof fakeGh>, extra: Partial<WiringDeps> = {}): WiringDeps => ({ fetch: slack.fetch, slackToken: 'xoxb-test', exec: gh.exec, inputCommit: () => 'a'.repeat(40), home: join(tmpdir(), 'benny-no-such-home'), ...extra });
