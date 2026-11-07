// Supplementary, added after the scored run: PROMPT-MODE-STICKY on Pi through one `pi --mode rpc` process,
// so /mode state never has to cross process boundaries. Writes the score.mjs layout under runs-sticky-rpc/.
// Usage: node probe-sticky-rpc.mjs --archive <pi-pstack.tgz> [--repeats 2]
import { spawn, execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, symlink, unlink, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';

const here = dirname(new URL(import.meta.url).pathname);
const { values: opts } = parseArgs({ options: { archive: { type: 'string' }, repeats: { type: 'string', default: '2' }, out: { type: 'string', default: join(here, 'runs-sticky-rpc') } } });
const archive = resolve(opts.archive);
const pi = join(homedir(), '.pi/agent/bin/pi');
const scenario = JSON.parse(await readFile(join(here, 'corpus.json'), 'utf8')).scenarios.find((entry) => entry.id === 'PROMPT-MODE-STICKY');
const authValues = [];
(function collect(value) { if (typeof value === 'string' && value.length >= 16) authValues.push(value); else if (value && typeof value === 'object') Object.values(value).forEach(collect); })(JSON.parse(await readFile(join(homedir(), '.pi/agent/auth.json'), 'utf8')));
const scrub = (text) => authValues.reduce((acc, value) => acc.replaceAll(value, '[REDACTED]'), text).replace(/eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]+/g, '[REDACTED_JWT]');

function snapshot(work, env) {
  const git = (...args) => execFileSync('git', args, { cwd: work, env, encoding: 'utf8' }).trimEnd();
  return { files: git('ls-files', '-co', '--exclude-standard').split('\n').map((path) => ({ path })), head: git('rev-parse', 'HEAD'), tree: git('rev-parse', 'HEAD^{tree}'), status: git('status', '--porcelain=v1', '-uall'), diff: git('diff', '--binary', 'HEAD') };
}

const scratch = await mkdtemp(join(tmpdir(), 'pstack-sticky-rpc-'));
for (let repeat = 1; repeat <= Number(opts.repeats); repeat += 1) {
  const id = `${String(repeat).padStart(2, '0')}-PROMPT-MODE-STICKY-rpc-r${repeat}`;
  const evidence = join(opts.out, id, 'pi');
  await mkdir(evidence, { recursive: true });
  const home = join(scratch, id, 'home');
  const work = join(scratch, id, 'work');
  await mkdir(join(home, 'tmp'), { recursive: true });
  await mkdir(work, { recursive: true });
  const env = { PATH: [dirname(process.execPath), '/usr/bin', '/bin', '/usr/sbin', '/sbin'].join(':'), HOME: home, TMPDIR: join(home, 'tmp'), LANG: 'en_US.UTF-8', TZ: 'UTC', TERM: 'dumb', NO_COLOR: '1', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', PI_CODING_AGENT_DIR: join(home, '.pi/agent'), PI_SKIP_VERSION_CHECK: '1' };
  await writeFile(join(work, 'README.md'), '# Unchanged prompt corpus fixture\n');
  const fixtureEnv = { ...env, GIT_AUTHOR_DATE: '2026-11-06T00:00:00Z', GIT_COMMITTER_DATE: '2026-11-06T00:00:00Z' };
  for (const args of [['init', '-q', '--initial-branch=main'], ['add', 'README.md'], ['-c', 'user.name=Corpus fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'Initial fixture']]) execFileSync('git', args, { cwd: work, env: fixtureEnv });
  const result = { host: 'pi', scenarioId: scenario.id, attempt: id, transport: 'rpc', turns: [], before: snapshot(work, env) };
  execFileSync(pi, ['install', `npm:@justjoshn/pi-pstack@file:${archive}`], { cwd: work, env, stdio: 'ignore' });
  const link = join(env.PI_CODING_AGENT_DIR, 'auth.json');
  await symlink(join(homedir(), '.pi/agent/auth.json'), link);
  const child = spawn(pi, ['--mode', 'rpc', '--model', 'openai/gpt-5.6-sol', '--thinking', 'medium', '--no-mcp', '--session-dir', join(scratch, id, 'sessions')], { cwd: work, env, stdio: ['pipe', 'pipe', 'pipe'] });
  let buffer = ''; let current = []; let waiter = null;
  child.stdout.on('data', (chunk) => {
    buffer += chunk.toString('utf8');
    let at;
    while ((at = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, at).replace(/\r$/, ''); buffer = buffer.slice(at + 1);
      if (!line.trim()) continue;
      current.push(line);
      let event; try { event = JSON.parse(line); } catch { continue; }
      waiter?.(event);
    }
  });
  const stderr = [];
  child.stderr.on('data', (chunk) => stderr.push(chunk));
  for (const [index, message] of scenario.messages.entries()) {
    current = [];
    const started = Date.now();
    const done = new Promise((settle) => {
      const timer = setTimeout(() => settle({ timedOut: true }), scenario.turnTimeoutMs);
      waiter = (event) => {
        if (event.type === 'response' && event.id === `turn-${index + 1}` && (!event.success || event.data?.disposition === 'handled')) { clearTimeout(timer); settle({ timedOut: false, response: event }); }
        if (event.type === 'agent_settled') { clearTimeout(timer); settle({ timedOut: false }); }
      };
    });
    child.stdin.write(`${JSON.stringify({ id: `turn-${index + 1}`, type: 'prompt', message })}\n`);
    const outcome = await done;
    await new Promise((wait) => setTimeout(wait, 500));
    await writeFile(join(evidence, `turn-${index + 1}.stdout`), scrub(`${current.join('\n')}\n`));
    result.turns.push({ turn: index + 1, exit: { code: 0, timedOut: outcome.timedOut, durationMs: Date.now() - started }, response: outcome.response ?? null });
    console.log(`${id} turn ${index + 1} ${outcome.response?.data?.disposition ?? 'settled'} ${Math.round((Date.now() - started) / 1000)}s`);
  }
  child.stdin.end();
  await new Promise((closed) => child.on('close', closed));
  await unlink(link);
  await writeFile(join(evidence, 'stderr.txt'), scrub(Buffer.concat(stderr).toString('utf8')));
  result.after = snapshot(work, env);
  result.hostModelRule = { path: '.pi/agent/pstack/pstack-models.md', exists: existsSync(join(home, '.pi/agent/pstack/pstack-models.md')) };
  result.credentialLinksRemoved = !existsSync(link);
  await writeFile(join(evidence, 'result.json'), `${JSON.stringify(result, null, 2)}\n`);
}
await rm(scratch, { recursive: true, force: true });
