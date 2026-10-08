import { spawn } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative } from 'node:path';

import { readonlyDigest } from './resource-workflows-doctor-readonly.mjs';

const inside = (path, root) => path === root || (!isAbsolute(relative(root, path)) && !relative(root, path).startsWith('..'));
const pin = (path) => {
  const canonical = realpathSync(path);
  if (!lstatSync(canonical).isFile()) throw new Error('Doctor readonly runtime must be a regular file');
  return Object.freeze({ path: canonical, sha256: readonlyDigest(readFileSync(canonical)) });
};
const assertPin = (item) => {
  if (readonlyDigest(readFileSync(item.path)) !== item.sha256) throw new Error(`Doctor readonly pinned source changed ${item.path}`);
};
const quote = (value) => `'${value.replaceAll("'", "'\\''")}'`;

function pythonJson(value) {
  if (Array.isArray(value)) return `[${value.map(pythonJson).join(', ')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).map(([key, item]) => `${pythonJson(key)}: ${pythonJson(item)}`).join(', ')}}`;
  return JSON.stringify(value).replace(/[\u007f-\uffff]/g, (character) => `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`);
}

function loaderDeclarations(records) {
  let branch = records.slice(1);
  if (typeof branch.at(-1)?.id === 'string') {
    const index = new Map(branch.filter((record) => typeof record.id === 'string').map((record) => [record.id, record]));
    let current = branch.at(-1);
    let chain = [];
    for (let remaining = branch.length; current && remaining > 0; remaining -= 1) {
      chain = [current, ...chain];
      current = typeof current.parentId === 'string' ? index.get(current.parentId) : null;
    }
    branch = chain;
  }
  let sections = {};
  let tools = {};
  for (const record of branch) {
    const message = record.message;
    if (message?.role !== 'system') continue;
    for (const [key, value] of Object.entries(message.sections ?? {})) {
      if (value === null) sections = Object.fromEntries(Object.entries(sections).filter(([name]) => name !== key));
      else sections = { ...sections, [key]: typeof value === 'string' ? value : pythonJson(value) };
    }
    const removed = new Set((message.toolsRemoved ?? []).map((tool) => tool.name));
    tools = { ...Object.fromEntries(Object.entries(tools).filter(([name]) => !removed.has(name))), ...Object.fromEntries((message.toolsAdded ?? []).map((tool) => [tool.name, pythonJson(tool).length])) };
  }
  const skills = [...(sections.skills ?? '').matchAll(/<skill>\s*<name>(.*?)<\/name>.*?<location>(.*?)<\/location>\s*<\/skill>/gs)].map((match) => ({ name: match[1], location: match[2], chars: [...match[0]].length }));
  return { tools, skills };
}

export function validateDoctorLoaderEvidence(facts, expected = null) {
  const { agentDir, cwd, settings, image, session, sessionDir, inventory } = facts;
  for (const path of [agentDir, cwd, settings, image, session, sessionDir]) if (realpathSync(path) !== path) throw new Error('Doctor loader rejects noncanonical source identity');
  if (settings !== join(agentDir, 'settings.json') || !inside(session, sessionDir)) throw new Error('Doctor loader has wrong target settings or session directory');
  const records = readFileSync(session, 'utf8').trim().split('\n').map((line) => JSON.parse(line));
  if (records[0]?.type !== 'session' || records[0].cwd !== cwd || !records.some((record) => record.message?.role === 'system' && record.message.sections && Array.isArray(record.message.toolsAdded)))
    throw new Error('Doctor loader session lacks actual system-role sections and tool declarations');
  if (!inventory?.prompt || inventory.prompt.session !== session || !Array.isArray(inventory.prompt.loaded_skills) || !inventory.prompt.tool_chars || inventory.partial === true)
    throw new Error('Doctor loader inventory lacks actual session prompt evidence');
  const declarations = loaderDeclarations(records);
  const sorted = (value) => JSON.stringify(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)));
  if (sorted(declarations.tools) !== sorted(inventory.prompt.tool_chars)) throw new Error('Doctor loader declarations differ from actual active session records');
  if (JSON.stringify(declarations.skills) !== JSON.stringify(inventory.prompt.loaded_skills)) throw new Error('Doctor loader skills differ from actual active session records');
  JSON.parse(readFileSync(settings, 'utf8'));
  const value = {
    sourceBound: true, agentDir, cwd, settings, image, session, sessionDir,
    settingsSha256: readonlyDigest(readFileSync(settings)), imageSha256: readonlyDigest(readFileSync(image)), sessionSha256: readonlyDigest(readFileSync(session)),
    inventorySha256: readonlyDigest(JSON.stringify(inventory)), loadedSkills: structuredClone(inventory.prompt.loaded_skills), toolDeclarations: structuredClone(inventory.prompt.tool_chars),
  };
  if (expected) for (const field of Object.keys(value)) if (JSON.stringify(value[field]) !== JSON.stringify(expected[field])) throw new Error(`Doctor loader source mismatch ${field}`);
  return Object.freeze(value);
}

export async function runDoctorReadonlyChild(plan, { signal, deadline }) {
  for (const item of plan.pins) assertPin(item);
  if (signal.aborted || performance.now() >= deadline) throw new Error('Doctor readonly total deadline expired before child launch');
  const child = spawn('/usr/bin/sandbox-exec', ['-f', plan.profile, plan.executable, ...plan.argv], { cwd: plan.cwd, env: { ...plan.env }, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = Buffer.alloc(0);
  let stderr = Buffer.alloc(0);
  let rescued = false;
  let error = null;
  const kill = () => {
    rescued = true;
    try { if (child.pid) process.kill(-child.pid, 'SIGKILL'); }
    catch (failure) { if (failure.code !== 'ESRCH') error = failure.message; }
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
  };
  const collect = (name, chunk) => {
    if ((name === 'stdout' ? stdout.length : stderr.length) + chunk.length > 8388608) { error = 'Doctor readonly output limit exceeded'; kill(); return; }
    if (name === 'stdout') stdout = Buffer.concat([stdout, chunk]);
    else stderr = Buffer.concat([stderr, chunk]);
  };
  child.stdout.on('data', (chunk) => collect('stdout', chunk));
  child.stderr.on('data', (chunk) => collect('stderr', chunk));
  child.on('error', (failure) => { error = failure.message; });
  signal.addEventListener('abort', kill, { once: true });
  const exit = await new Promise((resolve) => child.once('close', (code, exitSignal) => resolve({ code, signal: exitSignal })));
  signal.removeEventListener('abort', kill);
  return Object.freeze({ pid: child.pid ?? null, processGroup: child.pid ?? null, ...exit, error, rescued, streamsClosed: child.stdout.destroyed && child.stderr.destroyed, stdout: stdout.toString('utf8'), stderr: stderr.toString('utf8'), stdoutSha256: readonlyDigest(stdout), stderrSha256: readonlyDigest(stderr), source: { executable: plan.executable, argv: [...plan.argv], cwd: plan.cwd, pins: plan.pins } });
}

export function prepareDoctorReadonlyOperations({ doctor, repoRoot, root, directory, expectedSettingsSha256 = null }) {
  const owned = realpathSync(root);
  const target = realpathSync(doctor.agentDir);
  const cwd = realpathSync(doctor.cwd);
  const output = realpathSync(directory);
  if (inside(output, owned) || !inside(target, owned) || !inside(cwd, owned)) throw new Error('Doctor readonly authority must be separate from its owned target');
  const base = readFileSync(doctor.profile, 'utf8').trimEnd().split('\n').filter((line) => !line.startsWith('(allow network'));
  if (base.at(-1)?.startsWith('(allow file-write') !== true || base.filter((line) => line === '(deny file-write*)').length !== 1 || !base.some((line) => line.includes('(deny network'))) throw new Error('Doctor readonly requires the fixed offline baseline');
  const image = pin(doctor.imagePath);
  const inventory = pin(join(repoRoot, 'skills/doctor/scripts/inventory.py'));
  const python = pin('/usr/bin/python3');
  const sandbox = pin('/usr/bin/sandbox-exec');
  const node = pin(process.execPath);
  const managed = join(dirname(dirname(image.path)), 'install');
  const currentVersion = pin(join(managed, 'current-version'));
  if (readFileSync(currentVersion.path, 'utf8').trim() !== '1.1.0') throw new Error('Doctor readonly requires the pinned Pi 1.1.0 loader');
  const cli = pin(join(managed, 'releases/1.1.0/node_modules/@earendil-works/pi-coding-agent/dist/cli.js'));
  const settings = join(target, 'settings.json');
  const operations = Object.fromEntries(['gather', 'afterVerify'].map((operation) => {
    const sessions = join(owned, 'doctor-runtime', `readonly-${operation}-sessions`);
    const tmp = join(owned, 'doctor-runtime', `readonly-${operation}-tmp`);
    for (const path of [sessions, tmp]) mkdirSync(path, { recursive: true });
    const profile = join(output, `${operation}.sb`);
    const policy = `${base.slice(0, -1).join('\n')}\n(allow file-write* (subpath ${JSON.stringify(sessions)}) (subpath ${JSON.stringify(tmp)}) (literal ${JSON.stringify(join(target, 'auth.json.lock'))}) (literal ${JSON.stringify(`${settings}.lock`)}) (literal ${JSON.stringify(join(cwd, '.pi/settings.json.lock'))}) (literal "/dev/null"))\n`;
    writeFileSync(profile, policy, { flag: 'wx', mode: 0o400 });
    const loaderProfile = join(output, `${operation}-loader.sb`);
    writeFileSync(loaderProfile, `${policy}(deny process-fork)\n`, { flag: 'wx', mode: 0o400 });
    const versionDirectory = join(output, `${operation}-version`);
    mkdirSync(versionDirectory);
    const versionWrapper = join(versionDirectory, 'pi');
    writeFileSync(versionWrapper, `#!/bin/sh\n[ "$#" -eq 1 ] && [ "$1" = '--version' ] || exit 64\nexec ${quote(image.path)} --version\n`, { flag: 'wx', mode: 0o500 });
    const profilePin = pin(profile);
    const fixedEnv = Object.freeze({ ...doctor.env, PI_CODING_AGENT_DIR: target, PI_OFFLINE: '1', PI_SKIP_VERSION_CHECK: '1', TMPDIR: tmp, PATH: `${versionDirectory}:${dirname(node.path)}:/usr/bin:/bin:/usr/sbin:/sbin` });
    const extensions = [doctor.sessionOptions.packagePath, ...(doctor.sessionOptions.extraExtensions ?? [])].filter(Boolean);
    const pins = Object.freeze([image, inventory, python, sandbox, node, currentVersion, cli, profilePin, pin(loaderProfile), pin(versionWrapper), ...extensions.map(pin)]);
    const print = Object.freeze({ executable: image.path, argv: Object.freeze(['--print', '--session-dir', sessions, ...extensions.flatMap((path) => ['-e', path]), 'Reply OK only. Do not use tools.']), cwd, env: fixedEnv, profile: loaderProfile, pins });
    const scan = Object.freeze({ executable: python.path, argv: Object.freeze([inventory.path, '--agent-dir', target, '--cwd', cwd, '--session-dir', sessions, '--days', '1']), cwd, env: fixedEnv, profile, pins });
    const usageScan = Object.freeze({ ...scan, argv: Object.freeze([inventory.path, '--agent-dir', target, '--cwd', cwd, '--session-dir', join(target, 'sessions'), '--days', '30']) });
    return [operation, async (context) => {
      const before = readonlyDigest(readFileSync(settings));
      if (operation === 'afterVerify' && expectedSettingsSha256 && before !== expectedSettingsSha256) throw new Error('Doctor readonly wrong target settings before fresh loader');
      if (readdirSync(sessions).length) throw new Error('Doctor readonly rejects stale nonempty loader session directory');
      const loader = await runDoctorReadonlyChild(print, context);
      const children = [loader];
      let scanResult = null;
      let evidence = null;
      let evidenceError = null;
      let inventoryWindow = null;
      if (loader.code === 0 && loader.stdout.trim() !== 'OK') evidenceError = 'Doctor fresh loader did not produce the actual requested OK reply';
      if (loader.code === 0 && loader.signal === null && !loader.error && !loader.rescued && !evidenceError) {
        scanResult = await runDoctorReadonlyChild(scan, context);
        children.push(scanResult);
        if (scanResult.code === 0 && !scanResult.error && scanResult.signal === null) {
          try {
            const parsed = JSON.parse(scanResult.stdout);
            if (readonlyDigest(readFileSync(settings)) !== before) throw new Error('Doctor readonly settings changed during fresh loading');
            evidence = validateDoctorLoaderEvidence({ agentDir: target, cwd, settings, image: image.path, session: parsed.prompt?.session, sessionDir: sessions, inventory: parsed });
          } catch (failure) { evidenceError = failure.message; }
        }
      }
      if (operation === 'gather' && evidence && !context.signal.aborted) {
        const usage = await runDoctorReadonlyChild(usageScan, context);
        children.push(usage);
        if (usage.code === 0 && !usage.error && usage.signal === null) {
          try { inventoryWindow = { days: 30, inventory: JSON.parse(usage.stdout), outputSha256: usage.stdoutSha256 }; }
          catch (failure) { evidenceError = failure.message; }
        }
      }
      return Object.freeze({ inventoryWindow, code: children.every((child) => child.code === 0 && !child.error) ? 0 : 1, signal: children.find((child) => child.signal)?.signal ?? null, streamsClosed: children.every((child) => child.streamsClosed), rescued: children.some((child) => child.rescued), children, evidence, evidenceError, descendantProof: null, originalInventoryVersionSemantics: 'subprocess.run(["pi", "--version"]) through source-pinned exact-argument wrapper inheriting inventory readonly sandbox', originalSDKbash: false, loaderNoFork: true, versionNoFork: false });
    }];
  }));
  return Object.freeze(operations);
}
