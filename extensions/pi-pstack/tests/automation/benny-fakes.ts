// Fakes for the two external edges of the Benny serve process: Slack's HTTP API and the `gh` CLI. Both keep state, so a
// test can assert what the destination holds after a crash and a restart, not only which calls were made.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, utimesSync, writeFileSync } from 'node:fs';
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
  files?: { id: string; name: string; title: string }[];
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
  /** Evidence uploads. `denyUploads` makes `files.completeUploadExternal` answer with that error. `hideReads` makes a shared upload invisible to the next N thread reads, which is Slack's lag. */
  const uploads: { thread_ts: string; text: string; files: { name: string; title: string; bytes: Buffer }[] }[] = [];
  const uploadCalls: string[] = [];
  const pendingUploads = new Map<string, { name: string; bytes?: Buffer }>();
  const uploadState: { deny: string | undefined; hideReads: number; credentialsSeenByUploadHost: (string | null)[] } = { deny: undefined, hideReads: 0, credentialsSeenByUploadHost: [] };
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
    if (init?.method === 'POST' && new URL(String(input)).hostname === 'files.slack.com' && new URL(String(input)).pathname.startsWith('/upload/')) {
      const id = new URL(String(input)).pathname.split('/').at(-1) as string;
      uploadState.credentialsSeenByUploadHost.push(new Headers(init.headers).get('authorization'));
      const pending = pendingUploads.get(id);
      if (pending === undefined) return new Response('unknown upload', { status: 404 });
      pending.bytes = Buffer.from(init.body as Uint8Array);
      uploadCalls.push(`upload:${pending.name}`);
      return new Response('OK', { status: 200 });
    }
    if (init?.method !== 'POST') {
      const url = String(input);
      downloads.push({ url, authorization: new Headers(init?.headers).get('authorization'), ...(init?.redirect === undefined ? {} : { redirect: init.redirect }) });
      const file = files.get(url);
      if (file === undefined) return new Response('not found', { status: 404 });
      return new Response(file.bytes as ConstructorParameters<typeof Response>[0], { status: file.status ?? 200, headers: { 'content-type': file.contentType } });
    }
    const method = new URL(String(input)).pathname.split('/').at(-1) as string;
    if (method === 'files.getUploadURLExternal') {
      if (new Headers(init?.headers).get('content-type') !== 'application/x-www-form-urlencoded') return new Response(JSON.stringify({ ok: false, error: 'invalid_arguments' }));
      const form = new URLSearchParams(String(init?.body));
      const id = `F${String(pendingUploads.size + 1).padStart(8, '0')}`;
      pendingUploads.set(id, { name: form.get('filename') ?? '' });
      uploadCalls.push(`getUploadURLExternal:${form.get('filename')}:${form.get('length')}`);
      return new Response(JSON.stringify({ ok: true, upload_url: `https://files.slack.com/upload/v1/${id}`, file_id: id }));
    }
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    if (method === 'files.completeUploadExternal') {
      uploadCalls.push('completeUploadExternal');
      if (uploadState.deny !== undefined) return new Response(JSON.stringify({ ok: false, error: uploadState.deny }));
      const shared = (body['files'] as { id: string; title: string }[]).map((file) => ({ id: file.id, name: pendingUploads.get(file.id)?.name ?? '', title: file.title, bytes: pendingUploads.get(file.id)?.bytes ?? Buffer.alloc(0) }));
      const ts = `1762900001.${String(messages.length).padStart(6, '0')}`;
      messages.push({ ts, user: TRIAGE_USER, text: String(body['initial_comment']), files: shared.map(({ id, name, title }) => ({ id, name, title })) });
      posts.push({ thread_ts: String(body['thread_ts']), text: String(body['initial_comment']) });
      uploads.push({ thread_ts: String(body['thread_ts']), text: String(body['initial_comment']), files: shared.map(({ name, title, bytes }) => ({ name, title, bytes })) });
      return (dropAck.delete(method) && new Response(JSON.stringify({ ok: false, error: 'internal_error' }))) || new Response(JSON.stringify({ ok: true, files: shared.map(({ id }) => ({ id })) }));
    }
    const reply = (value: Record<string, unknown>) => new Response(JSON.stringify({ ok: true, ...value }));
    const toOps = body['channel'] === OPS_CHANNEL;
    calls.push(`${method}${toOps ? ':ops' : ''}`);
    if (toOps && state.opsDown) return new Response(JSON.stringify({ ok: false, error: 'channel_not_found' }));
    const landedButLost = () => dropAck.delete(method) && new Response(JSON.stringify({ ok: false, error: 'internal_error' }));
    if (method === 'conversations.replies') {
      if (toOps) return reply({ messages: ops.filter((message) => message.ts === body['ts'] || message.thread_ts === body['ts']) });
      const visible = messages.filter((message) => message.ts === ROOT_TS || message.ts > ROOT_TS);
      if (uploadState.hideReads > 0 && visible.some((message) => message.files !== undefined)) {
        uploadState.hideReads -= 1;
        return reply({ messages: visible.filter((message) => message.files === undefined) });
      }
      return reply({ messages: visible });
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
  return { messages, posts, ops, opsEdits, calls, dropAck, state, files, downloads, uploads, uploadCalls, uploadState, fetch: fetchFake };
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
export interface FakePull {
  number: number;
  head: string;
  base: string;
  title: string;
  body: string;
  draft: boolean;
  state: 'OPEN' | 'CLOSED' | 'MERGED';
  comments: string[];
}

export function fakeGh(seed: Pick<Issue, 'title' | 'body' | 'state'>[] = []) {
  const issues: Issue[] = seed.map((issue, index) => ({ ...issue, number: index + 1, labels: [], comments: [] }));
  const calls: string[][] = [];
  /** The pull requests of the code repository, behind `gh pr ...`. `failures` makes a matching call throw, `remaining` times. */
  const pulls: FakePull[] = [];
  const failures: { when: (args: string[]) => boolean; remaining: number }[] = [];
  const pullJson = (pull: FakePull) => ({ number: pull.number, url: `https://github.com/example-org/example-repo/pull/${pull.number}`, isDraft: pull.draft, state: pull.state, body: pull.body });
  const exec: GhExec = async (args) => {
    calls.push(args);
    const failing = failures.find((failure) => failure.remaining > 0 && failure.when(args));
    if (failing !== undefined) {
      failing.remaining -= 1;
      throw new Error(`gh ${args.slice(0, 2).join(' ')} failed: simulated outage`);
    }
    if (args[0] === 'pr') {
      const option = (name: string) => args[args.indexOf(name) + 1] ?? '';
      if (args[1] === 'list') return JSON.stringify(pulls.filter((pull) => pull.head === option('--head')).map(pullJson));
      if (args[1] === 'create') {
        const pull: FakePull = { number: pulls.length + 1, head: option('--head'), base: option('--base'), title: option('--title'), body: option('--body'), draft: args.includes('--draft'), state: 'OPEN', comments: [] };
        pulls.push(pull);
        return `${pullJson(pull).url}\n`;
      }
      const pull = pulls.find((candidate) => candidate.number === Number(args[2]));
      if (pull === undefined) throw new Error(`gh: no pull request ${args[2]}`);
      if (args[1] === 'view') return JSON.stringify(pullJson(pull));
      if (args[1] === 'ready' && args.includes('--undo')) pull.draft = true;
      else if (args[1] === 'close') {
        pull.state = 'CLOSED';
        pull.comments.push(option('--comment'));
      } else throw new Error(`gh: unexpected ${args.slice(0, 3).join(' ')}`);
      return '';
    }
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
  return { issues, calls, exec, pulls, failures };
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
    .replace('artifact_directory: "/tmp/benny-artifacts"', `artifact_directory: "${join(dir, 'artifacts')}"`)
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

/**
 * The proof record a repro worker leaves (src/automation/proof.ts): `runs` observations, each with its own capture written
 * at `at` and a timestamp one second apart. A second call adds to the record, so a later turn's observations are newer.
 */
export function writeProof(dir: string, runId: RunId, at: Date, options: { section?: 'reproductions' | 'baseline' | 'patched' | 'fix.patched'; tag?: string; runs?: number; extra?: Record<string, unknown> } = {}): string {
  const folder = join(dir, 'artifacts', runId);
  mkdirSync(folder, { recursive: true });
  const file = join(folder, 'repro.json');
  const record = existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as Record<string, any>) : {};
  const tag = options.tag ?? 'repro';
  const runs = Array.from({ length: options.runs ?? 2 }, (_, index) => {
    const name = `${tag}-${index + 1}.png`;
    const path = join(folder, name);
    writeFileSync(path, Buffer.from([0x89, 0x50, 0x4e, 0x47, index, tag.length, ...Buffer.from(`${tag}${runId}${at.toISOString()}${index}`)]));
    utimesSync(path, at, at);
    return { at: new Date(at.getTime() + index * 1000).toISOString(), artifact: name, state: 'the Export button does nothing' };
  });
  const section = options.section ?? 'reproductions';
  if (section === 'reproductions') record['reproductions'] = [...(record['reproductions'] ?? []), ...runs];
  else if (section === 'fix.patched') record['fix'] = { ...(record['fix'] ?? {}), patched: [...(record['fix']?.patched ?? []), ...runs] };
  else record['existingFix'] = { ...(record['existingFix'] ?? {}), [section]: runs };
  Object.assign(record, options.extra ?? {});
  writeFileSync(file, JSON.stringify(record));
  return folder;
}

export const CODE_REPO_URL = 'https://github.com/example-org/example-repo.git';

/**
 * A real git repository for the project, with a bare repository standing in for GitHub: the worktree's `origin` is the
 * github.com url the configuration names, and git rewrites it to the bare repository, so a push lands somewhere a test can
 * read. A worker's worktree is created the way the host creates it, on `pstack-run/<runId>/owner`.
 */
export function gitProject(dir: string, options: { existing?: boolean } = {}) {
  const git = (cwd: string, ...args: string[]) => execFileSync('git', ['-C', cwd, '-c', 'user.name=worker', '-c', 'user.email=worker@example.com', ...args], { encoding: 'utf8' }).trim();
  const origin = join(mkdtempSync(join(tmpdir(), 'benny-origin-')), 'origin.git');
  mkdirSync(origin, { recursive: true });
  git(origin, 'init', '--quiet', '--bare', '-b', 'main');
  if (options.existing !== true) {
    git(dir, 'init', '--quiet', '-b', 'main');
    writeFileSync(join(dir, 'README.md'), 'fixture\n');
    writeFileSync(join(dir, '.gitignore'), '.pi/\nartifacts/\n');
    git(dir, 'add', 'README.md', '.gitignore');
    git(dir, 'commit', '--quiet', '-m', 'init');
  }
  git(dir, 'remote', 'add', 'origin', CODE_REPO_URL);
  git(dir, 'config', `url.file://${origin}.insteadOf`, CODE_REPO_URL);
  const commit = git(dir, 'rev-parse', 'HEAD');
  const worktree = (runId: RunId) => join(workerDir(dir, runId), 'worktree');
  return {
    commit,
    origin,
    worktree,
    branch: (runId: RunId) => `pstack-run/${runId}/owner`,
    /** The worker's worktree, created as the host creates it. */
    startWorker: (runId: RunId) => void git(dir, 'worktree', 'add', '--quiet', '-b', `pstack-run/${runId}/owner`, worktree(runId), commit),
    /** The worker commits a file in its worktree. */
    commitIn: (runId: RunId, name: string, text: string) => {
      writeFileSync(join(worktree(runId), name), text);
      git(worktree(runId), 'add', name);
      git(worktree(runId), 'commit', '--quiet', '-m', `fix: ${name}`);
    },
    /** Branches the bare repository holds. */
    remoteBranches: () => git(origin, 'for-each-ref', '--format=%(refname:short)', 'refs/heads').split('\n').filter((line) => line !== ''),
    git,
  };
}
