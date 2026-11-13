// Shared core for the repo's verify-* skill harnesses: scratch runs and their ownership, cleanup,
// evidence directories, the installed `pi` CLI in print, RPC, and tmux-hosted TUI form, and the
// `doctor | drive <feature>|all [--out <dir>] [--keep] | cleanup` command line. A skill supplies
// only what is specific to it: setup (peers, stubs, env), its drives, a post-drive check, and
// doctor checks. This directory has no SKILL.md, so Pi does not load it as a skill.
import assert from 'node:assert/strict';
import { execFile, execFileSync, spawn } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

export const TIMEOUT_MS = 60_000;
export const log = (line) => process.stdout.write(`${line}\n`);
export const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

// ---------- scratch runs ----------

// A run is a scratch dir owned by one drive process: `agent/` (PI_CODING_AGENT_DIR), `cwd/`, and
// run.json naming the owner, the private tmux socket, and the child PIDs it started.
export async function createRun({ prefix, feature }) {
  const root = await mkdtemp(join(tmpdir(), prefix));
  try {
    const run = { root, feature, ownerPid: process.pid, agentDir: join(root, 'agent'), cwd: join(root, 'cwd'), tmuxSocket: `${prefix}${root.split('-').at(-1)}`, pids: [] };
    await Promise.all([mkdir(run.agentDir), mkdir(run.cwd)]);
    await saveRun(run);
    return run;
  } catch (error) {
    await rm(root, { recursive: true, force: true });
    throw error;
  }
}

export const saveRun = (run) => writeFile(join(run.root, 'run.json'), JSON.stringify(run, null, 2));

export function readRunFile(root) {
  try {
    return JSON.parse(readFileSync(join(root, 'run.json'), 'utf8'));
  } catch {
    return undefined;
  }
}

// Things that live in the drive process (peers, sinks) and must stop with the run.
const stopHooks = new Map();
export function onStop(run, hook) {
  stopHooks.set(run.root, [...(stopHooks.get(run.root) ?? []), hook]);
}

// The working directory of a live process, or undefined. Every process a run starts has the run's
// cwd, so a recorded PID whose cwd differs was reused by an unrelated process.
function processCwd(pid) {
  try {
    const out = execFileSync('lsof', ['-a', '-p', String(pid), '-d', 'cwd', '-Fn'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    return out
      .split('\n')
      .find((line) => line.startsWith('n'))
      ?.slice(1);
  } catch {
    return undefined;
  }
}

function realPath(path) {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

// Kills the run's tmux server and every recorded PID that still has the run's cwd. Never by name.
export function killRun(run) {
  try {
    execFileSync('tmux', ['-L', run.tmuxSocket, 'kill-server'], { stdio: 'ignore' });
  } catch {
    // No server on this socket.
  }
  rmSync(join(process.env.TMUX_TMPDIR ?? '/tmp', `tmux-${process.getuid()}`, run.tmuxSocket), { force: true });
  const cwd = realPath(run.cwd);
  for (const pid of run.pids ?? []) {
    if (processCwd(pid) !== cwd) continue;
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      // Already gone.
    }
  }
}

export async function stopRun(run) {
  killRun(run);
  const hooks = stopHooks.get(run.root) ?? [];
  stopHooks.delete(run.root);
  await Promise.all(hooks.map((hook) => hook()));
}

export async function destroyRun(run) {
  await stopRun(run);
  await rm(run.root, { recursive: true, force: true });
}

// True when ownerPid is another live process running `scriptName`.
export function ownerAlive(ownerPid, scriptName) {
  if (!ownerPid || ownerPid === process.pid) return false;
  try {
    process.kill(ownerPid, 0);
    return execFileSync('ps', ['-o', 'command=', '-p', String(ownerPid)], { encoding: 'utf8' }).includes(scriptName);
  } catch {
    return false;
  }
}

// Every `<prefix>*` dir in the temp dir, sorted by whether this harness may remove it.
export function scratchStatus({ prefix, scriptName }) {
  const status = { removable: [], active: [], unrecognized: [] };
  for (const name of readdirSync(tmpdir()).filter((entry) => entry.startsWith(prefix))) {
    const root = join(tmpdir(), name);
    const run = readRunFile(root);
    if (run?.root !== root || !run.feature) status.unrecognized.push(root);
    else if (ownerAlive(run.ownerPid, scriptName)) status.active.push(root);
    else status.removable.push(run);
  }
  return status;
}

async function cleanup({ prefix, scriptName }) {
  const { removable, active, unrecognized } = scratchStatus({ prefix, scriptName });
  for (const root of unrecognized) log(`skipped ${root}: no run.json from this harness, so it was not created here`);
  for (const root of active) log(`skipped ${root}: its drive is still running`);
  for (const run of removable) {
    killRun(run);
    await rm(run.root, { recursive: true, force: true });
    log(`removed ${run.root}`);
  }
  if (removable.length + active.length + unrecognized.length === 0) log('nothing to clean');
}

// ---------- evidence ----------

// Lists every file the harness writes into an evidence dir, so a rerun can tell its own files from
// anything else.
const EVIDENCE_MANIFEST = '.verify-evidence.json';

// Clears `dir` only when it is empty or holds nothing but files this harness wrote, and claims it
// with a RUNNING run.json so a second drive cannot clobber it. Every write passes through `scrub`.
// `step(name, fn)` runs one named step of a drive and records it in steps.json; a drive whose
// steps all pass gets its summary from them.
export async function evidenceDir({ dir, feature, scriptName, scrub = (text) => text }) {
  if (existsSync(dir)) {
    let written = [];
    try {
      written = JSON.parse(readFileSync(join(dir, EVIDENCE_MANIFEST), 'utf8')).files ?? [];
    } catch {
      // No manifest: only an empty dir may be reused.
    }
    const foreign = readdirSync(dir).filter((name) => name !== EVIDENCE_MANIFEST && !written.includes(name));
    if (foreign.length > 0) throw new Error(`Refusing to clear ${dir}: it holds files this harness did not write (${foreign.slice(0, 3).join(', ')}${foreign.length > 3 ? ', …' : ''}). Pick another --out.`);
    const previous = readRunFile(dir);
    if (previous?.status === 'RUNNING' && ownerAlive(previous.ownerPid, scriptName)) throw new Error(`Refusing to clear ${dir}: drive ${previous.ownerPid} is still writing it.`);
  }
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });
  const files = new Set();
  const steps = [];
  const write = async (name, content) => {
    files.add(name);
    await writeFile(join(dir, EVIDENCE_MANIFEST), `${JSON.stringify({ files: [...files] })}\n`);
    await writeFile(join(dir, name), scrub(content));
  };
  const evidence = {
    dir,
    steps,
    json: (name, value) => write(name, `${JSON.stringify(value, null, 2)}\n`),
    text: (name, value) => write(name, value),
    async step(name, fn) {
      const started = Date.now();
      try {
        const result = await fn();
        steps.push({ name, status: 'PASS', ms: Date.now() - started, ...result });
        return result;
      } catch (error) {
        steps.push({ name, status: 'FAIL', ms: Date.now() - started, error: error.message });
        throw error;
      } finally {
        await evidence.json('steps.json', steps);
      }
    },
  };
  await evidence.json('run.json', { feature, status: 'RUNNING', ownerPid: process.pid, startedAt: new Date().toISOString() });
  return evidence;
}

// ---------- the installed pi CLI ----------

// Print mode (or any one-shot pi command). Resolves with the exit code and both streams.
export function runPi(run, { env, args }) {
  return new Promise((done) => {
    const child = execFile('pi', args, { cwd: run.cwd, env, timeout: TIMEOUT_MS }, (error, stdout, stderr) => {
      done({ args: ['pi', ...args].join(' '), exitCode: error ? (error.code ?? 1) : 0, stdout, stderr });
    });
    // Print mode reads piped stdin until it closes.
    child.stdin.end();
  });
}

// `pi --mode rpc`: send() a command and await its response, waitFor() an event, prompt() and wait
// for the agent to settle, stop() the process.
export function startRpc(run, { env, args }) {
  const child = spawn('pi', args, { cwd: run.cwd, env, stdio: ['pipe', 'pipe', 'pipe'] });
  if (child.pid) run.pids.push(child.pid);
  const pending = new Map();
  const waiters = [];
  let spawnError;
  let stderr = '';
  let seq = 0;
  let buffer = '';
  // A spawn failure rejects everything outstanding instead of crashing the drive.
  child.on('error', (error) => {
    spawnError = error;
    for (const { reject } of pending.values()) reject(error);
    pending.clear();
    for (const waiter of waiters.splice(0)) waiter.fail(error);
  });
  child.stdin.on('error', () => undefined);
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    buffer += chunk;
    for (let at = buffer.indexOf('\n'); at >= 0; at = buffer.indexOf('\n')) {
      const line = buffer.slice(0, at).trim();
      buffer = buffer.slice(at + 1);
      if (!line) continue;
      let record;
      try {
        record = JSON.parse(line);
      } catch {
        continue;
      }
      if (record.type === 'response' && pending.has(record.id)) {
        const { resolve: ok, reject: fail } = pending.get(record.id);
        pending.delete(record.id);
        record.success ? ok(record.data) : fail(new Error(record.error ?? `${record.command} failed`));
        continue;
      }
      for (const waiter of [...waiters]) {
        if (waiter.match(record)) {
          waiters.splice(waiters.indexOf(waiter), 1);
          waiter.done(record);
        }
      }
    }
  });
  child.stderr.on('data', (chunk) => {
    stderr += chunk;
  });
  const exited = new Promise((done) => child.once('close', done));
  const rpc = {
    send(command) {
      seq += 1;
      const id = `req-${seq}`;
      if (spawnError) return Promise.reject(spawnError);
      return new Promise((ok, fail) => {
        const timer = setTimeout(() => fail(new Error(`RPC ${command.type} timed out. stderr:\n${stderr}`)), TIMEOUT_MS);
        pending.set(id, {
          resolve: (value) => {
            clearTimeout(timer);
            ok(value);
          },
          reject: (error) => {
            clearTimeout(timer);
            fail(error);
          },
        });
        child.stdin.write(`${JSON.stringify({ id, ...command })}\n`);
      });
    },
    // Resolves with the first matching event. cancel() drops the wait and its timer.
    waitFor(match) {
      let entry;
      const promise = new Promise((ok, fail) => {
        const timer = setTimeout(() => {
          waiters.splice(waiters.indexOf(entry), 1);
          fail(new Error(`RPC event wait timed out. stderr:\n${stderr}`));
        }, TIMEOUT_MS);
        entry = {
          match,
          timer,
          done: (record) => {
            clearTimeout(timer);
            ok(record);
          },
          fail: (error) => {
            clearTimeout(timer);
            fail(error);
          },
        };
        waiters.push(entry);
      });
      promise.cancel = () => {
        clearTimeout(entry.timer);
        const at = waiters.indexOf(entry);
        if (at >= 0) waiters.splice(at, 1);
      };
      return promise;
    },
    async prompt(message) {
      const settled = rpc.waitFor((record) => record.type === 'agent_settled');
      try {
        const response = await rpc.send({ type: 'prompt', message });
        if (response?.disposition !== 'handled') await settled;
        return response;
      } finally {
        settled.cancel();
        settled.catch(() => undefined);
      }
    },
    async stop() {
      if (!child.pid || child.exitCode !== null) return;
      child.stdin.end();
      const timer = setTimeout(() => child.kill('SIGKILL'), 5000);
      await Promise.race([exited, sleep(10_000)]);
      clearTimeout(timer);
    },
  };
  return rpc;
}

// ---------- the interactive TUI in a private tmux server ----------

// tmux on the run's private socket: kill-server only ever touches the server this run started.
export function tmux(run, ...args) {
  return execFileSync('tmux', ['-L', run.tmuxSocket, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

// Writes tui.sh (the exact env, with `unset` for every name the harness scrubs) and starts it.
export async function startTui(run, { env, args, unset = [] }) {
  const exports = Object.entries(env)
    .filter(([name]) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(name))
    .map(([name, value]) => `export ${name}='${String(value).replaceAll("'", "'\\''")}'`);
  const unsets = unset.filter((name) => !(name in env)).map((name) => `unset ${name}`);
  const script = join(run.root, 'tui.sh');
  await writeFile(script, ['#!/bin/sh', ...unsets, ...exports, `cd '${run.cwd}'`, `exec pi ${args.map((arg) => `'${arg}'`).join(' ')}`, ''].join('\n'));
  await chmod(script, 0o755);
  tmux(run, 'new-session', '-d', '-s', 'pi', '-x', '220', '-y', '60', script);
  run.pids.push(Number(tmux(run, 'display-message', '-p', '-t', 'pi', '#{pane_pid}').trim()));
  await saveRun(run);
  await waitForPane(run, 'v1.');
}

export async function stopTui(run) {
  killRun(run);
  run.pids = [];
  await saveRun(run);
}

export const pane = (run) => tmux(run, 'capture-pane', '-p', '-J', '-S', '-300', '-t', 'pi');
export const keys = (run, ...names) => tmux(run, 'send-keys', '-t', 'pi', ...names);
export const type = (run, value) => tmux(run, 'send-keys', '-t', 'pi', '-l', value);

export async function waitForPane(run, needle, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const current = pane(run);
    if (needle instanceof RegExp ? needle.test(current) : current.includes(needle)) return current;
    if (Date.now() > deadline) throw new Error(`TUI never showed ${needle}. Last pane:\n${current}`);
    await sleep(200);
  }
}

export async function waitUntil(label, test, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  while (!(await test())) {
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${label}`);
    await sleep(100);
  }
}

// /login → Sign in with an account → type `filter` → wait for `→ <label>` → Enter.
export async function openLogin(run, filter, label = filter) {
  type(run, '/login');
  keys(run, 'Enter');
  await waitForPane(run, 'Select authentication method');
  keys(run, 'Enter');
  await waitForPane(run, 'Select provider to configure');
  type(run, filter);
  await waitForPane(run, `→ ${label}`);
  keys(run, 'Enter');
}

// ---------- command line ----------

function nodeCheck() {
  const [major, minor] = process.versions.node.split('.').map(Number);
  assert.ok(major > 22 || (major === 22 && minor >= 19), process.version);
  return process.version;
}

// skill: {
//   scriptName, prefix, evidenceRoot, scrub?, scrubbedEnv, drives: { name: fn(ctx) },
//   setup({ run, evidence, feature }) → ctx   (start peers, write stubs; register stops with onStop)
//   check?(ctx, feature)                       (invariants every drive must hold, run after a pass)
//   doctor(check)                              (skill checks; check(name, fn) records one)
// }
export async function runCli(skill, argv = process.argv.slice(2)) {
  const [command, feature, ...rest] = argv;
  const at = rest.indexOf('--out');
  const out = at < 0 ? undefined : rest[at + 1];
  const keep = rest.includes('--keep');
  try {
    if (at >= 0 && (!out || out.startsWith('--'))) throw new Error('--out needs a directory');
    if (command === 'doctor') await doctor(skill);
    else if (command === 'drive' && feature === 'all') {
      for (const name of Object.keys(skill.drives)) await drive(skill, name, out ? join(out, name) : undefined, keep);
    } else if (command === 'drive') await drive(skill, feature, out, keep);
    else if (command === 'cleanup') await cleanup(skill);
    else {
      log(`usage: ${skill.scriptName} doctor | drive <${Object.keys(skill.drives).join('|')}|all> [--out <dir>] [--keep] | cleanup`);
      process.exitCode = command ? 1 : 0;
    }
  } catch (error) {
    log(`error: ${error.message}`);
    process.exitCode = 1;
  }
}

async function drive(skill, feature, out, keep) {
  const fn = skill.drives[feature];
  if (!fn) throw new Error(`Unknown feature ${feature}. Known: ${Object.keys(skill.drives).join(', ')}`);
  const evidence = await evidenceDir({ dir: resolve(out ?? join(skill.evidenceRoot, feature)), feature, scriptName: skill.scriptName, scrub: skill.scrub });
  const startedAt = new Date().toISOString();
  let run;
  let summary;
  let failure;
  try {
    run = await createRun({ prefix: skill.prefix, feature });
    const ctx = await skill.setup({ run, evidence, feature });
    const returned = await fn(ctx);
    await skill.check?.(ctx, feature);
    summary = returned ?? evidence.steps.map((step) => `${step.name}: ${step.summary ?? 'PASS'}`);
  } catch (error) {
    failure = error;
    try {
      if (run && existsSync(join(run.root, 'tui.sh'))) await evidence.text('failure-pane.txt', pane(run));
    } catch {
      // No pane to capture.
    }
  } finally {
    // Tear down first, so nothing below can strand the scratch dir, tmux server, or peers.
    if (run) {
      try {
        if (keep) await stopRun(run);
        else await destroyRun(run);
      } catch (error) {
        failure ??= error;
      }
    }
    let piVersion;
    try {
      piVersion = execFileSync('pi', ['--version'], { encoding: 'utf8' }).trim();
    } catch (error) {
      piVersion = `unknown (${error.message.split('\n')[0]})`;
    }
    await evidence.json('run.json', {
      feature,
      startedAt,
      finishedAt: new Date().toISOString(),
      piVersion,
      platform: `${process.platform}/${process.arch}`,
      status: failure ? 'FAIL' : 'PASS',
      error: failure?.message,
      summary,
      scratch: run ? (keep ? run.root : '(removed)') : '(never created)',
    });
  }
  log(JSON.stringify({ feature, status: failure ? 'FAIL' : 'PASS', evidence: evidence.dir, summary, error: failure?.message }, null, 2));
  if (failure) process.exitCode = 1;
}

async function doctor(skill) {
  const checks = [];
  const check = async (name, fn) => {
    try {
      checks.push({ name, ok: true, detail: await fn() });
    } catch (error) {
      checks.push({ name, ok: false, detail: error.message.split('\n')[0] });
    }
  };
  await check('node >= 22.19.0', nodeCheck);
  await check('pi on PATH', () => execFileSync('pi', ['--version'], { encoding: 'utf8' }).trim());
  await check('tmux on PATH', () => execFileSync('tmux', ['-V'], { encoding: 'utf8' }).trim());
  // Teardown kills a recorded PID only after lsof confirms its cwd; cleanup uses ps to spot live drives.
  await check('lsof and ps on PATH (process ownership checks)', () => {
    execFileSync('lsof', ['-v'], { stdio: 'ignore' });
    execFileSync('ps', ['-o', 'pid=', '-p', String(process.pid)], { stdio: 'ignore' });
    return 'present';
  });
  await skill.doctor(check);
  const { removable, active, unrecognized } = scratchStatus(skill);
  checks.push({
    name: 'no leftover scratch runs',
    ok: removable.length === 0,
    detail: `${removable.length ? `${removable.length} leftover; run \`${skill.scriptName} cleanup\`` : 'none'}${active.length ? ` (${active.length} active drive(s) ignored)` : ''}`,
  });
  if (unrecognized.length) checks.push({ name: 'unrecognized scratch dirs', ok: false, detail: `${unrecognized.join(', ')} have no run.json from this harness; cleanup leaves them, so inspect and remove them by hand` });
  const ambient = skill.scrubbedEnv.filter((name) => process.env[name]);
  checks.push({ name: 'ambient env (scrubbed from drives)', ok: true, detail: ambient.length ? ambient.join(', ') : 'none' });
  for (const { name, ok, detail } of checks) log(`${ok ? 'ok  ' : 'FAIL'} ${name}: ${detail}`);
  if (checks.some((c) => !c.ok)) process.exitCode = 1;
}

// The env every Pi process gets: the caller's env minus `scrubbedEnv`, plus the skill's values.
export function cleanEnv(scrubbedEnv, values) {
  const env = { ...process.env };
  for (const name of scrubbedEnv) delete env[name];
  return { ...env, PI_SKIP_VERSION_CHECK: '1', PI_TELEMETRY: '0', ...values };
}
