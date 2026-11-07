// Captures every declared attempt of corpus.json on Cursor CLI and Pi. Capture only; score.mjs scores.
// Usage: node run-corpus.mjs --archive <pi-pstack.tgz> --plugin <pstack dir> --plugin <cursor-team-kit dir> [--out runs] [--only ID,...]
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, unlink, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';

const here = dirname(new URL(import.meta.url).pathname);
const { values: opts } = parseArgs({ options: {
  archive: { type: 'string' }, plugin: { type: 'string', multiple: true }, out: { type: 'string', default: join(here, 'runs') },
  only: { type: 'string' }, 'pi-bin': { type: 'string', default: join(homedir(), '.pi/agent/bin/pi') },
  'cursor-bin': { type: 'string', default: join(homedir(), '.local/bin/cursor-agent') },
} });
if (!opts.archive || opts.plugin?.length !== 2) throw new Error('Need --archive and two --plugin dirs (pstack, cursor-team-kit)');
const archive = resolve(opts.archive);
const plugins = opts.plugin.map((path) => resolve(path));
const MODEL = { cursor: 'gpt-5.6-sol-medium', pi: 'openai/gpt-5.6-sol', thinking: 'medium' };
const README = '# Unchanged prompt corpus fixture\n';
const SETUP_TIMEOUT_MS = 120_000;
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const writeJson = (path, value) => writeFile(path, `${JSON.stringify(value, null, 2)}\n`);

const userAuth = join(homedir(), '.pi/agent/auth.json');
const secrets = new Set();
(function collect(value) {
  if (typeof value === 'string' && value.length >= 16) secrets.add(value);
  else if (value && typeof value === 'object') Object.values(value).forEach(collect);
})(JSON.parse(await readFile(userAuth, 'utf8')));
const needles = [...secrets].sort((a, b) => b.length - a.length);
function scrub(text) {
  for (const value of needles) text = text.replaceAll(value, '[REDACTED]');
  return text
    .replace(/Bearer\s+[A-Za-z0-9_.~+/=-]+/gi, 'Bearer [REDACTED]')
    .replace(/eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]+/g, '[REDACTED_JWT]')
    .replace(/\b(sk|rt|pk)-[A-Za-z0-9_-]{20,}/g, '[REDACTED_KEY]');
}

const groups = new Set();
const killGroup = (pid, signal) => { try { process.kill(-pid, signal); } catch {} };
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { for (const pid of groups) killGroup(pid, 'SIGKILL'); process.exit(130); });

async function run(executable, args, { cwd, env, timeout = SETUP_TIMEOUT_MS, prefix }) {
  const started = Date.now();
  const child = spawn(executable, args, { cwd, env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  groups.add(child.pid);
  const out = []; const err = [];
  child.stdout.on('data', (chunk) => out.push(chunk));
  child.stderr.on('data', (chunk) => err.push(chunk));
  let timedOut = false; let spawnError = null;
  child.on('error', (error) => { spawnError = error.message; });
  const timer = setTimeout(() => { timedOut = true; killGroup(child.pid, 'SIGTERM'); setTimeout(() => killGroup(child.pid, 'SIGKILL'), 2000); }, timeout);
  const exit = await new Promise((done) => child.on('close', (code, signal) => done({ code, signal })));
  clearTimeout(timer);
  killGroup(child.pid, 'SIGKILL');
  groups.delete(child.pid);
  const stdout = scrub(Buffer.concat(out).toString('utf8'));
  const stderr = scrub(Buffer.concat(err).toString('utf8'));
  const result = { ...exit, timedOut, spawnError, durationMs: Date.now() - started, timeoutMs: timeout };
  if (prefix) {
    await writeFile(`${prefix}.stdout`, stdout);
    await writeFile(`${prefix}.stderr`, stderr);
    await writeJson(`${prefix}.process.json`, { executable, argv: args.map(scrub), cwd, exit: result });
  }
  return { exit: result, stdout, stderr };
}

function hostEnv(home, host) {
  const env = {
    PATH: [dirname(process.execPath), '/usr/bin', '/bin', '/usr/sbin', '/sbin'].join(':'), HOME: home,
    XDG_CONFIG_HOME: join(home, '.config'), XDG_CACHE_HOME: join(home, '.cache'), XDG_DATA_HOME: join(home, '.local/share'),
    TMPDIR: join(home, 'tmp'), LANG: 'en_US.UTF-8', LC_ALL: 'en_US.UTF-8', TZ: 'UTC', TERM: 'dumb', NO_COLOR: '1',
    GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_TERMINAL_PROMPT: '0',
  };
  if (host === 'pi') Object.assign(env, { PI_CODING_AGENT_DIR: join(home, '.pi/agent'), PI_SKIP_VERSION_CHECK: '1' });
  return env;
}

async function manifest(root, prefix = '') {
  const files = [];
  for (const entry of (await readdir(join(root, prefix), { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    if (!prefix && entry.name === '.git') continue;
    const path = join(prefix, entry.name);
    if (entry.isDirectory()) files.push(...await manifest(root, path));
    else files.push({ path, sha256: entry.isFile() ? sha256(await readFile(join(root, path))) : 'non-regular' });
  }
  return files;
}

async function snapshot(work, env) {
  const git = async (...args) => (await run('git', args, { cwd: work, env })).stdout.trimEnd();
  return { files: await manifest(work), head: await git('rev-parse', 'HEAD'), tree: await git('rev-parse', 'HEAD^{tree}'), status: await git('status', '--porcelain=v1', '-uall'), diff: await git('diff', '--binary', 'HEAD') };
}

async function copyTextTree(from, to) {
  if (!existsSync(from)) return 0;
  let count = 0;
  for (const entry of await readdir(from, { withFileTypes: true, recursive: true })) {
    if (!entry.isFile() || !/\.(jsonl|json|txt|md)$/.test(entry.name)) continue;
    const source = join(entry.parentPath, entry.name);
    const target = join(to, source.slice(from.length));
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, scrub(await readFile(source, 'utf8')));
    count += 1;
  }
  return count;
}

async function runHost(host, attempt, scenario, scratch) {
  const evidence = join(opts.out, attempt.id, host);
  await mkdir(evidence, { recursive: true });
  const root = join(scratch, attempt.id, host);
  const home = join(root, 'home');
  const work = join(root, 'work');
  await mkdir(join(home, 'tmp'), { recursive: true });
  const env = hostEnv(home, host);
  const links = [];
  const result = { host, scenarioId: scenario.id, attempt: attempt.id, model: host === 'pi' ? { selector: MODEL.pi, thinking: MODEL.thinking } : { selector: MODEL.cursor }, turns: [] };
  try {
    await mkdir(work, { recursive: true });
    await writeFile(join(work, 'README.md'), README);
    const fixtureEnv = { ...env, GIT_AUTHOR_DATE: '2026-11-06T00:00:00Z', GIT_COMMITTER_DATE: '2026-11-06T00:00:00Z' };
    for (const args of [['init', '-q', '--initial-branch=main'], ['add', 'README.md'], ['-c', 'user.name=Corpus fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'Initial fixture']]) {
      const step = await run('git', args, { cwd: work, env: fixtureEnv });
      if (step.exit.code !== 0) throw new Error(`fixture git ${args.join(' ')} failed`);
    }
    result.before = await snapshot(work, env);
    if (host === 'pi') {
      const install = await run(opts['pi-bin'], ['install', `npm:@justjoshn/pi-pstack@file:${archive}`], { cwd: work, env, prefix: join(evidence, 'pi-install') });
      if (install.exit.code !== 0) throw new Error('pi install failed');
      result.piSettings = JSON.parse(await readFile(join(env.PI_CODING_AGENT_DIR, 'settings.json'), 'utf8'));
      const link = join(env.PI_CODING_AGENT_DIR, 'auth.json');
      await symlink(userAuth, link);
      links.push(link);
    } else {
      await mkdir(join(home, 'Library'), { recursive: true });
      const link = join(home, 'Library/Keychains');
      await symlink(join(homedir(), 'Library/Keychains'), link);
      links.push(link);
    }
    const sessionDir = join(root, 'sessions');
    await mkdir(sessionDir);
    const piSessionId = randomUUID();
    let cursorSession = null;
    for (const [index, message] of scenario.messages.entries()) {
      const args = host === 'pi'
        ? ['--mode', 'json', '--model', MODEL.pi, '--thinking', MODEL.thinking, '--no-mcp', '--session-dir', sessionDir, '--session-id', piSessionId, '--', message]
        : ['--print', '--output-format', 'stream-json', '--trust', '--force', '--model', MODEL.cursor, ...plugins.flatMap((plugin) => ['--plugin-dir', plugin]), ...(cursorSession ? ['--resume', cursorSession] : []), '--', message];
      const turn = await run(host === 'pi' ? opts['pi-bin'] : opts['cursor-bin'], args, { cwd: work, env, timeout: scenario.turnTimeoutMs, prefix: join(evidence, `turn-${index + 1}`) });
      if (host === 'cursor' && !cursorSession) {
        for (const line of turn.stdout.split('\n')) {
          try { const event = JSON.parse(line); if (event.type === 'system' && event.session_id) { cursorSession = event.session_id; break; } } catch {}
        }
      }
      result.turns.push({ turn: index + 1, inputSha256: sha256(message), exit: turn.exit, cursorSession });
      console.log(`${attempt.id} ${host} turn ${index + 1} exit=${turn.exit.code} timedOut=${turn.exit.timedOut} ${Math.round(turn.exit.durationMs / 1000)}s`);
    }
    if (host === 'pi') result.piSessionId = piSessionId;
  } catch (error) {
    result.setupError = scrub(String(error.message));
  } finally {
    for (const link of links) await unlink(link).catch(() => {});
    result.credentialLinksRemoved = links.every((link) => !existsSync(link));
    if (result.before) result.after = await snapshot(work, env).catch((error) => ({ error: error.message }));
    const rule = host === 'pi' ? join(home, '.pi/agent/pstack/pstack-models.md') : join(home, '.cursor/rules/pstack-models.mdc');
    result.hostModelRule = { path: rule.slice(home.length + 1), exists: existsSync(rule) };
    result.retained = {
      sessions: await copyTextTree(join(root, 'sessions'), join(evidence, 'sessions')),
      hostState: host === 'pi'
        ? await copyTextTree(join(home, '.pi/agent/pstack'), join(evidence, 'pi-pstack-state'))
        : await copyTextTree(join(home, '.cursor/projects'), join(evidence, 'cursor-projects')),
    };
    await writeJson(join(evidence, 'result.json'), result);
  }
  return result;
}

const corpusBytes = await readFile(join(here, 'corpus.json'));
const corpus = JSON.parse(corpusBytes);
const only = opts.only ? new Set(opts.only.split(',')) : null;
const attempts = [];
for (const scenario of corpus.scenarios) {
  for (let repeat = 1; repeat <= scenario.repeats; repeat += 1) {
    const ordinal = attempts.length + 1;
    attempts.push({ id: `${String(ordinal).padStart(2, '0')}-${scenario.id}-r${repeat}`, ordinal, scenarioId: scenario.id, repeat, order: ordinal % 2 ? ['cursor', 'pi'] : ['pi', 'cursor'] });
  }
}
await mkdir(opts.out, { recursive: true });
const versionEnv = { PATH: `${dirname(process.execPath)}:/usr/bin:/bin`, HOME: homedir() };
const pluginRevisions = [];
for (const plugin of plugins) {
  const rev = (await run('git', ['-C', plugin, 'rev-parse', 'HEAD'], { cwd: here, env: versionEnv })).stdout.trim();
  const dirty = (await run('git', ['-C', plugin, 'status', '--porcelain', '--', '.'], { cwd: here, env: versionEnv })).stdout.trim();
  if (rev !== corpus.sourceRevision || dirty) throw new Error(`Plugin ${plugin} is not clean at ${corpus.sourceRevision}`);
  pluginRevisions.push({ plugin, rev });
}
await writeJson(join(opts.out, 'intent.json'), {
  startedAt: new Date().toISOString(), corpusSha256: sha256(corpusBytes), runnerSha256: sha256(await readFile(new URL(import.meta.url))),
  archive: { path: archive, sha256: sha256(await readFile(archive)) }, pluginRevisions, model: MODEL,
  versions: { cursor: (await run(opts['cursor-bin'], ['--version'], { cwd: here, env: versionEnv })).stdout.trim(), pi: (await run(opts['pi-bin'], ['--version'], { cwd: here, env: versionEnv })).stdout.trim(), node: process.version },
  attempts: attempts.filter((attempt) => !only || only.has(attempt.id)),
});
const scratch = await mkdtemp(join(tmpdir(), 'pstack-corpus-'));
try {
  for (const attempt of attempts) {
    if (only && !only.has(attempt.id)) continue;
    const scenario = corpus.scenarios.find((entry) => entry.id === attempt.scenarioId);
    await mkdir(join(opts.out, attempt.id), { recursive: true });
    for (const [index, message] of scenario.messages.entries()) await writeFile(join(opts.out, attempt.id, `input-turn-${index + 1}.txt`), message);
    for (const host of attempt.order) await runHost(host, attempt, scenario, scratch);
    await writeJson(join(opts.out, attempt.id, 'pair.json'), attempt);
    await rm(join(scratch, attempt.id), { recursive: true, force: true });
  }
} finally {
  for (const pid of groups) killGroup(pid, 'SIGKILL');
  await rm(scratch, { recursive: true, force: true });
}
console.log('corpus run complete');
