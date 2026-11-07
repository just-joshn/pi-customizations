import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmod, copyFile, lstat, mkdir, mkdtemp, readFile, readdir, readlink, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

const MODEL_TIMEOUT_MS = 180_000;
const SETUP_TIMEOUT_MS = 120_000;
const MAX_OUTPUT_BYTES = 64 * 1024 * 1024;
const README = '# Unchanged prompt corpus fixture\n';
const MODEL = { cursor: 'gpt-5.6-sol-medium', pi: 'openai/gpt-5.6-sol', thinking: 'medium' };
const activeGroups = new Set();

export function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

export function declareAttempts(corpus) {
  if (corpus.schemaVersion !== 1 || corpus.protocol?.repeats !== 3 || corpus.scenarios?.length !== 5) {
    throw new Error('Expected the frozen schema-1 corpus with five scenarios and three repeats');
  }
  const ids = new Set();
  return corpus.scenarios.flatMap((scenario) => {
    if (!/^[A-Z0-9-]+$/.test(scenario.id) || ids.has(scenario.id)) throw new Error('Invalid or duplicate scenario ID');
    ids.add(scenario.id);
    if (!scenario.messages?.length || scenario.messages.some((text) => typeof text !== 'string' || !text.length)) {
      throw new Error(`Invalid messages for ${scenario.id}`);
    }
    const supported = ['unchangedTree', 'forbiddenTools', 'requiredText', 'exactFinalText'];
    if (Object.keys(scenario.automatic ?? {}).some((key) => !supported.includes(key))) throw new Error('Unknown automatic predicate');
    return Array.from({ length: corpus.protocol.repeats }, (_, repeat) => {
      const ordinal = (ids.size - 1) * corpus.protocol.repeats + repeat + 1;
      return {
        id: `${String(ordinal).padStart(2, '0')}-${scenario.id}-r${repeat + 1}`,
        ordinal,
        scenarioId: scenario.id,
        repeat: repeat + 1,
        order: ordinal % 2 ? ['cursor', 'pi'] : ['pi', 'cursor'],
        messages: scenario.messages.map((text, turn) => ({ turn: turn + 1, utf8Bytes: Buffer.byteLength(text), sha256: sha256(text) })),
        automatic: scenario.automatic,
        semanticAssertions: scenario.assertions,
        semanticStatus: 'PENDING_INDEPENDENT_REVIEW',
      };
    });
  });
}

function messageText(message) {
  if (typeof message?.content === 'string') return message.content;
  return (Array.isArray(message?.content) ? message.content : []).filter((part) => part.type === 'text').map((part) => part.text).join('');
}

function canonicalTool(name) {
  const short = name.replace(/^.*[.:/]/, '').replace(/ToolCall$/, '').replace(/[_-]/g, '').toLowerCase();
  const aliases = {
    read: 'read', readfile: 'read', shell: 'bash', bash: 'bash', exec: 'bash',
    write: 'write', writefile: 'write', writetofile: 'write', edit: 'edit', editfile: 'edit', applypatch: 'edit', strreplace: 'edit',
    task: 'Task', todowrite: 'TodoWrite', loop: 'Loop', delete: 'delete',
    glob: 'find', grep: 'grep', ls: 'ls', find: 'find', websearch: 'web_search', webfetch: 'web_fetch',
    getmcptools: 'GetDynamicTools', getdynamictools: 'GetDynamicTools',
    callmcp: 'CallDynamicTool', callmcptool: 'CallDynamicTool', calldynamic: 'CallDynamicTool', calldynamictool: 'CallDynamicTool',
  };
  return aliases[short] ?? name;
}

export function parseHostEvents(host, raw) {
  if (!['cursor', 'pi'].includes(host)) throw new Error(`Unknown host ${host}`);
  const events = [];
  const malformed = [];
  for (const [index, line] of raw.split('\n').entries()) {
    if (!line.trim()) continue;
    try {
      const event = JSON.parse(line);
      if (!event || typeof event !== 'object' || Array.isArray(event)) throw new Error('Not an object');
      events.push(event);
    } catch {
      malformed.push({ line: index + 1, text: line });
    }
  }
  const tools = [];
  const errors = [];
  const identities = [];
  let finalText = '';
  let sessionId = null;
  let completed = false;
  const addError = (value) => { if (value) errors.push(typeof value === 'string' ? value : JSON.stringify(value)); };
  for (const event of events) {
    if (event.type === 'error' || event.type === 'extension_error') addError(event.error ?? event.message ?? event);
    if (event.type === 'auto_retry_start') addError(event.errorMessage);
    if (event.type === 'auto_retry_end' && event.success === false) addError(event.finalError ?? event);
    if (host === 'pi') {
      if (event.type === 'session') sessionId = event.id;
      if (event.type === 'agent_settled') {
        completed = event.aborted === false;
        if (event.aborted) addError('Pi agent_settled was aborted');
      }
      const messages = event.type === 'message_end' ? [event.message] : event.type === 'agent_end' ? event.messages ?? [] : [];
      for (const message of messages) {
        if (message?.role !== 'assistant') continue;
        identities.push({ provider: message.provider, model: message.model, api: message.api, thinking: message.thinkingLevel });
        if (message.stopReason === 'error' || message.stopReason === 'aborted' || message.errorMessage) {
          addError(message.errorMessage ?? message.stopReason);
        }
        if (event.type === 'message_end') finalText = messageText(message);
      }
      if (event.type === 'message_update' && event.assistantMessageEvent?.type === 'error') addError(event.assistantMessageEvent.error);
      if (event.type === 'tool_execution_start') {
        tools.push({ id: event.toolCallId, name: canonicalTool(event.toolName), rawName: event.toolName, args: event.args });
      }
      if (event.type === 'tool_execution_end' && event.isError) addError({ tool: event.toolName, result: event.result });
    } else if (host === 'cursor') {
      if (event.type === 'system' && event.subtype === 'init') {
        sessionId = event.session_id;
        identities.push({ model: event.model, contextReported: event.model?.match(/(\d+(?:\.\d+)?[KM])\s*Medium/i)?.[1] ?? null, permissionMode: event.permissionMode });
      }
      if (event.type === 'assistant') finalText = messageText(event.message);
      if (event.type === 'result') {
        completed = event.subtype === 'success' && event.is_error === false;
        if (typeof event.result === 'string') finalText = event.result;
        if (!completed) addError(event);
      }
      if (event.type === 'tool_call' && event.subtype === 'started') {
        const entries = Object.entries(event.tool_call ?? {}).filter(([key]) => key.endsWith('ToolCall'));
        if (!entries.length) tools.push({ id: event.call_id, name: 'UNKNOWN', raw: event.tool_call });
        for (const [key, value] of entries) {
          const args = value?.args ?? {};
          const directName = args.toolName ?? args.tool_name ?? args.name;
          const wrapper = canonicalTool(key);
          tools.push({ id: event.call_id, name: wrapper === 'CallDynamicTool' && directName ? canonicalTool(directName) : wrapper, rawName: key, args });
        }
      }
      if (event.type === 'tool_call' && event.subtype === 'completed') {
        for (const value of Object.values(event.tool_call ?? {})) {
          if (value?.result?.error || value?.result?.isError) addError(value.result);
        }
      }
    } else {
      throw new Error(`Unknown host ${host}`);
    }
  }
  return {
    host, sessionId, completed, finalText, tools, malformed,
    errors: [...new Set(errors)],
    identities: [...new Map(identities.map((value) => [JSON.stringify(value), value])).values()],
    eventCount: events.length,
  };
}

export function evaluateAutomatic(automatic, turns, before, after) {
  const checks = [];
  const check = (id, passed, detail) => checks.push({ id, status: passed ? 'PASS' : 'FAIL', detail });
  check('all-turns-executed', turns.length > 0 && turns.every((turn) => !turn.blocked), turns.map((turn) => turn.blocked ?? 'executed'));
  for (const [index, turn] of turns.entries()) {
    const parsed = turn.parsed;
    check(`turn-${index + 1}-process`, turn.exit?.code === 0 && !turn.exit?.timedOut && !turn.exit?.outputLimit && !turn.exit?.spawnError, turn.exit);
    check(`turn-${index + 1}-protocol`, parsed?.completed === true && parsed.malformed.length === 0, { completed: parsed?.completed, malformed: parsed?.malformed.length });
    check(`turn-${index + 1}-errors`, parsed?.errors.length === 0, parsed?.errors ?? ['No parsed output']);
    check(`turn-${index + 1}-model-reported`, parsed?.identities.length > 0 && parsed.identities.every((identity) => parsed.host === 'pi'
      ? identity.model === 'gpt-5.6-sol' && identity.provider === 'openai' && identity.thinking === MODEL.thinking
      : parsed.host === 'cursor' && /^GPT-5\.6 Sol\s*\d+(?:\.\d+)?[KM]\s*Medium$/i.test(identity.model ?? '')), parsed?.identities);
  }
  if (turns.length > 1) check('same-session-continuation', Boolean(turns[0].parsed?.sessionId) && turns.every((turn) => turn.parsed?.sessionId === turns[0].parsed.sessionId), turns.map((turn) => turn.parsed?.sessionId));
  if (automatic.unchangedTree) {
    check('unchanged-tree', Boolean(before && after) && JSON.stringify(before.files) === JSON.stringify(after.files)
      && before.head === after.head && before.tree === after.tree && after.status === '' && after.diff === '', { before, after });
  }
  const tools = turns.flatMap((turn) => turn.parsed?.tools ?? []);
  const forbidden = tools.filter((tool) => automatic.forbiddenTools?.includes(tool.name));
  check('forbidden-tools', forbidden.length === 0, forbidden);
  const classifiedTools = ['read', 'bash', 'write', 'edit', 'Task', 'TodoWrite', 'Loop', 'delete', 'find', 'grep', 'ls', 'web_search', 'web_fetch', 'GetDynamicTools'];
  const unclassified = tools.filter((tool) => !classifiedTools.includes(tool.name));
  checks.push({ id: 'tool-policy-observable', status: unclassified.length ? 'UNVERIFIED' : 'PASS', detail: unclassified });
  const finalText = turns.at(-1)?.parsed?.finalText ?? '';
  for (const text of automatic.requiredText ?? []) {
    check(`text-presence-only:${text}`, finalText.toLowerCase().includes(text.toLowerCase()), 'String presence is not a semantic verdict');
  }
  if (automatic.exactFinalText !== undefined) check('exact-final-text', finalText === automatic.exactFinalText, { expected: automatic.exactFinalText, actual: finalText });
  return { status: checks.some((item) => item.status === 'FAIL') ? 'FAIL' : checks.some((item) => item.status === 'UNVERIFIED') ? 'UNVERIFIED' : 'PASS', scope: 'DETERMINISTIC_PRECHECKS_ONLY', semanticStatus: 'PENDING_INDEPENDENT_REVIEW', checks };
}

function makeRedactor(privateInputs) {
  const values = new Set(privateInputs.map((input) => input.path));
  const collect = (value) => {
    if (typeof value === 'string' && value.length >= 8) values.add(value);
    else if (value && typeof value === 'object') Object.values(value).forEach(collect);
  };
  for (const input of privateInputs) collect(JSON.parse(input.bytes));
  const needles = [...values].flatMap((value) => [value, JSON.stringify(value).slice(1, -1)]).sort((a, b) => b.length - a.length);
  return (text) => {
    for (const value of needles) text = text.replaceAll(value, '[PRIVATE_VALUE_REDACTED]');
    return text.replace(/Bearer\s+[A-Za-z0-9_.~+/-]+/gi, 'Bearer [PRIVATE_VALUE_REDACTED]');
  };
}

function signalGroup(pid, signal) {
  try { process.kill(-pid, signal); return true; } catch (error) { if (error.code !== 'ESRCH') throw error; return false; }
}

async function runProcess(executable, args, { cwd, env, timeout = SETUP_TIMEOUT_MS, prefix, redact }) {
  const startedAt = new Date().toISOString();
  const started = performance.now();
  let child;
  let timedOut = false;
  let outputLimit = false;
  let spawnError = null;
  let size = 0;
  const stdout = [];
  const stderr = [];
  let killTimer;
  const stop = () => {
    if (child?.pid) {
      signalGroup(child.pid, 'SIGTERM');
      killTimer ??= setTimeout(() => signalGroup(child.pid, 'SIGKILL'), 1000);
    }
  };
  child = spawn(executable, args, { cwd, env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  if (child.pid) activeGroups.add(child.pid);
  const capture = (target) => (chunk) => {
    size += chunk.length;
    if (size <= MAX_OUTPUT_BYTES) target.push(chunk);
    else if (!outputLimit) { outputLimit = true; stop(); }
  };
  child.stdout.on('data', capture(stdout));
  child.stderr.on('data', capture(stderr));
  child.on('error', (error) => { spawnError = error.message; });
  const timer = setTimeout(() => { timedOut = true; stop(); }, timeout);
  const exit = await new Promise((done) => child.on('close', (code, signal) => done({ code, signal })));
  clearTimeout(timer);
  clearTimeout(killTimer);
  if (child.pid) { signalGroup(child.pid, 'SIGKILL'); activeGroups.delete(child.pid); }
  const rawOut = Buffer.concat(stdout).toString('utf8');
  const rawErr = Buffer.concat(stderr).toString('utf8');
  const out = redact(rawOut);
  const err = redact(rawErr);
  const result = { ...exit, timedOut, outputLimit, spawnError, startedAt, durationMs: Math.round(performance.now() - started), capturedBytes: size, privateValuesRedacted: out !== rawOut || err !== rawErr };
  await writeFile(`${prefix}.stdout`, out);
  await writeFile(`${prefix}.stderr`, err);
  await writeJson(`${prefix}.process.json`, { executable, argv: args, cwd, env, timeoutMs: timeout, ownedProcessGroup: child.pid ?? null, exit: result });
  return { exit: result, stdout: out, stderr: err };
}

async function writeJson(path, value) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

function hostEnv(home, host) {
  const env = {
    PATH: [dirname(process.execPath), '/usr/bin', '/bin', '/usr/sbin', '/sbin'].join(':'), HOME: home,
    XDG_CONFIG_HOME: join(home, '.config'), XDG_CACHE_HOME: join(home, '.cache'), XDG_DATA_HOME: join(home, '.local/share'),
    TMPDIR: join(home, 'tmp'), LANG: 'en_US.UTF-8', LC_ALL: 'en_US.UTF-8', TZ: 'UTC', TERM: 'dumb', NO_COLOR: '1',
    GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_TERMINAL_PROMPT: '0',
  };
  if (host === 'cursor') env.AGENT_CLI_CREDENTIAL_STORE = 'file';
  if (host === 'pi') Object.assign(env, { PI_CODING_AGENT_DIR: join(home, '.pi/agent'), PI_OFFLINE: '1', PI_SKIP_VERSION_CHECK: '1' });
  return env;
}

async function fileManifest(root, prefix = '') {
  const files = [];
  for (const entry of (await readdir(join(root, prefix), { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    if (!prefix && entry.name === '.git') continue;
    const path = join(prefix, entry.name);
    const absolute = join(root, path);
    const stat = await lstat(absolute);
    if (stat.isSymbolicLink()) files.push({ path, symlink: await readlink(absolute) });
    else if (stat.isDirectory()) files.push(...await fileManifest(root, path));
    else if (stat.isFile()) files.push({ path, bytes: stat.size, mode: stat.mode & 0o777, sha256: sha256(await readFile(absolute)) });
  }
  return files;
}

async function gitSnapshot(work, env, evidence, redact, label) {
  const result = { files: await fileManifest(work) };
  for (const [key, args] of Object.entries({ head: ['rev-parse', 'HEAD'], tree: ['rev-parse', 'HEAD^{tree}'], status: ['status', '--porcelain=v1', '-uall'], diff: ['diff', '--binary', 'HEAD'] })) {
    const command = await runProcess('git', args, { cwd: work, env, prefix: join(evidence, `${label}-git-${key}`), redact });
    if (command.exit.code !== 0) throw new Error(`Cannot snapshot Git ${key}`);
    result[key] = command.stdout.trimEnd();
  }
  await writeJson(join(evidence, `${label}-snapshot.json`), result);
  return result;
}

async function requireSuccess(executable, args, context) {
  const result = await runProcess(executable, args, context);
  if (result.exit.code !== 0 || result.exit.timedOut || result.exit.outputLimit || result.exit.spawnError) throw new Error(`Setup command failed. See ${context.prefix}.process.json`);
  return result;
}

async function prepareFixture(work, env, evidence, redact) {
  await mkdir(work, { recursive: true });
  await writeFile(join(work, 'README.md'), README);
  const commands = [
    ['init', '-q', '--initial-branch=main'], ['add', 'README.md'],
    ['-c', 'user.name=Corpus fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'Initial fixture'],
  ];
  for (const [index, args] of commands.entries()) {
    await requireSuccess('git', args, { cwd: work, env: { ...env, GIT_AUTHOR_DATE: '2026-11-06T00:00:00Z', GIT_COMMITTER_DATE: '2026-11-06T00:00:00Z' }, prefix: join(evidence, `fixture-${index + 1}`), redact });
  }
}

async function runHost(host, attempt, scenario, options, scratch, redact, privateBytes) {
  const evidence = join(options.out, attempt.id, host);
  await mkdir(evidence, { recursive: true });
  const root = join(scratch, attempt.id, host);
  const home = join(root, 'home');
  const work = join(root, 'work');
  await mkdir(join(home, 'tmp'), { recursive: true, mode: 0o700 });
  const env = hostEnv(home, host);
  const credential = host === 'pi' ? join(env.PI_CODING_AGENT_DIR, 'auth.json') : join(home, '.cursor/auth.json');
  const result = { host, requestedModel: host === 'pi' ? { selector: MODEL.pi, thinking: MODEL.thinking } : { selector: MODEL.cursor }, turns: [], setup: 'PENDING', comparability: 'UNVERIFIED', semanticStatus: 'PENDING_INDEPENDENT_REVIEW' };
  try {
    await prepareFixture(work, env, evidence, redact);
    result.before = await gitSnapshot(work, env, evidence, redact, 'before');
    if (host === 'pi') {
      const dist = join(root, 'dist');
      await mkdir(dist);
      const archive = join(dist, 'baseline.tgz');
      await copyFile(options.tarball, archive);
      await requireSuccess('tar', ['-xzf', archive, '-C', dist], { cwd: root, env, prefix: join(evidence, 'extract'), redact });
      const packageRoot = join(dist, 'package');
      const manifest = JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8'));
      result.package = { name: manifest.name, version: manifest.version, root: packageRoot, manifestSha256: sha256(await readFile(join(packageRoot, 'package.json'))), dependencies: manifest.dependencies, installRoute: 'Packed tarball extracted, npm runtime dependencies only, then ordinary pi install of extracted local package' };
      await requireSuccess('npm', ['install', '--omit=dev', '--omit=peer', '--ignore-scripts', '--package-lock=false', '--no-audit', '--no-fund'], { cwd: packageRoot, env, prefix: join(evidence, 'runtime-dependencies'), redact });
      const installed = await fileManifest(join(packageRoot, 'node_modules'));
      const hostPackages = ['@earendil-works/pi-ai', '@earendil-works/pi-agent-core', '@earendil-works/pi-coding-agent', '@earendil-works/pi-tui', 'typebox'];
      const unwanted = [...hostPackages, 'vitest', 'typescript', 'fast-check', '@vitest/coverage-v8'].filter((name) => installed.some((file) => file.path === `${name}/package.json`));
      if (unwanted.length) throw new Error('Development or host peer packages were installed');
      result.package.runtimeTreeSha256 = sha256(JSON.stringify(installed));
      await writeJson(join(evidence, 'runtime-dependency-files.json'), installed);
      await requireSuccess(options['pi-bin'], ['install', packageRoot, '--no-approve'], { cwd: work, env, prefix: join(evidence, 'pi-install'), redact });
      const settings = JSON.parse(await readFile(join(env.PI_CODING_AGENT_DIR, 'settings.json'), 'utf8'));
      const roots = settings.packages?.map((source) => typeof source === 'string' ? resolve(env.PI_CODING_AGENT_DIR, source) : null);
      if (JSON.stringify(roots) !== JSON.stringify([packageRoot])) throw new Error('Unexpected installed package roots');
      result.isolation = { configuredPackageRoots: roots, noCopiedUserSettings: true, noCopiedModelRule: true, noCheckoutPackageRoots: true, copiedCredentialNotSymlinked: true };
    } else {
      result.isolation = { pluginRoots: options['plugin-root'].map((plugin) => resolve(plugin)), noCopiedUserSettings: true, noCopiedModelRule: true, credentialStore: 'file', copiedCredentialNotSymlinked: true };
    }
    await mkdir(dirname(credential), { recursive: true, mode: 0o700 });
    await writeFile(credential, privateBytes[host], { mode: 0o600, flag: 'wx' });
    await chmod(credential, 0o600);
    if (host === 'pi') {
      const listing = await requireSuccess(options['pi-bin'], ['--list-models', 'gpt-5.6-sol'], { cwd: work, env, prefix: join(evidence, 'model-catalog'), redact });
      result.modelCatalog = listing.stdout.trim();
      result.modelCatalogScope = 'Host static metadata, not proof of provider context or matching inference controls';
    }
    result.setup = 'COMPLETE';
    let sessionId;
    let sessionFile;
    const sessionDir = join(root, 'sessions');
    await mkdir(sessionDir);
    for (const [index, message] of scenario.messages.entries()) {
      if (index && (!sessionId || (host === 'pi' && !sessionFile))) {
        result.turns.push({ turn: index + 1, inputSha256: sha256(message), blocked: 'Previous turn did not establish a resumable session' });
        continue;
      }
      const args = host === 'pi'
        ? ['--mode', 'json', '--model', MODEL.pi, '--thinking', MODEL.thinking, '--no-mcp', ...(index ? ['--session', sessionFile] : ['--session-dir', sessionDir]), '--', message]
        : ['--print', '--output-format', 'stream-json', '--trust', '--model', MODEL.cursor, ...options['plugin-root'].flatMap((plugin) => ['--plugin-dir', resolve(plugin)]), ...(index ? ['--resume', sessionId] : []), '--', message];
      const invocation = await runProcess(options[`${host}-bin`], args, { cwd: work, env, timeout: MODEL_TIMEOUT_MS, prefix: join(evidence, `turn-${index + 1}`), redact });
      const parsed = parseHostEvents(host, invocation.stdout);
      result.turns.push({ turn: index + 1, inputSha256: sha256(message), exit: invocation.exit, parsed });
      await writeFile(join(evidence, `turn-${index + 1}-final.txt`), parsed.finalText);
      await writeJson(join(evidence, `turn-${index + 1}-parsed.json`), parsed);
      sessionId ??= parsed.sessionId;
      if (host === 'pi' && !sessionFile) {
        const sessions = (await readdir(sessionDir)).filter((name) => name.endsWith('.jsonl'));
        if (sessions.length === 1) sessionFile = join(sessionDir, sessions[0]);
      }
    }
    if (host === 'pi' && sessionFile) {
      await writeFile(join(evidence, 'retained-session.jsonl'), redact(await readFile(sessionFile, 'utf8')));
      result.sessionFile = sessionFile;
    }
  } catch (error) {
    result.setup = result.setup === 'COMPLETE' ? 'EXECUTION_ERROR' : 'FAILED';
    result.error = redact(error.message);
  } finally {
    await rm(credential, { force: true });
    let absent;
    try { await lstat(credential); absent = false; } catch (error) { if (error.code !== 'ENOENT') throw error; absent = true; }
    result.credentialCleanup = { removed: absent, sourceChangedByRunner: false, copiedFileMode: '0600', profileNotRetainedAsEvidence: true };
    if (result.before) {
      try { result.after = await gitSnapshot(work, env, evidence, redact, 'after'); } catch (error) { result.snapshotError = redact(error.message); }
    }
    result.automatic = evaluateAutomatic(scenario.automatic, result.turns, result.before, result.after);
    if (result.turns.length !== scenario.messages.length || result.setup !== 'COMPLETE' || !absent) result.automatic.status = 'FAIL';
    await writeJson(join(evidence, 'result.json'), result);
  }
  return result;
}

async function artifactManifest(root) {
  const files = await fileManifest(root);
  return files.map(({ path, bytes, sha256: digest }) => ({ path, bytes, sha256: digest }));
}

async function executableIdentity(path) {
  const actual = await realpath(path);
  return { suppliedPath: path, realpath: actual, sha256: sha256(await readFile(actual)) };
}

async function piInstallation(path) {
  const executable = await executableIdentity(path);
  const shebang = (await readFile(executable.realpath, 'utf8')).split('\n')[0];
  for (let root = dirname(executable.realpath); dirname(root) !== root; root = dirname(root)) {
    let bytes;
    try { bytes = await readFile(join(root, 'package.json')); } catch (error) { if (error.code === 'ENOENT') continue; throw error; }
    const manifest = JSON.parse(bytes);
    if (manifest.name !== '@earendil-works/pi-coding-agent' || !manifest.bin?.pi || resolve(root, manifest.bin.pi) !== executable.realpath) continue;
    return { executable, root, manifest, manifestSha256: sha256(bytes), shebang, nodeExecutable: await executableIdentity(process.execPath), installationMode: /^#!.*\bnode\b/.test(shebang) ? 'node' : 'UNVERIFIED', runtimeKind: /^#!.*\bnode\b/.test(shebang) ? 'node' : 'UNVERIFIED' };
  }
  return { executable, installationMode: 'UNVERIFIED', runtimeKind: 'UNVERIFIED', reason: 'No actual package bin and Node interpreter observation establishes the installation route.' };
}

export async function main(argv) {
  const { values } = parseArgs({ args: argv, options: {
    out: { type: 'string' }, tarball: { type: 'string' }, corpus: { type: 'string' },
    'plugin-root': { type: 'string', multiple: true }, 'cursor-auth': { type: 'string' }, 'pi-auth': { type: 'string' },
    'pi-bin': { type: 'string' }, 'cursor-bin': { type: 'string' }, 'summary-prefix': { type: 'string' },
  } });
  for (const key of ['out', 'tarball', 'corpus', 'cursor-auth', 'pi-auth', 'pi-bin', 'cursor-bin']) {
    if (!values[key]) throw new Error(`Missing --${key}`);
    values[key] = resolve(values[key]);
  }
  if (values['plugin-root']?.length !== 2) throw new Error('Supply --plugin-root separately for pstack and cursor-team-kit');
  if (values['summary-prefix'] && !basename(values['summary-prefix']).startsWith('corpus-baseline-summary')) throw new Error('Summary prefix must start with corpus-baseline-summary');
  const corpusBytes = await readFile(values.corpus);
  const corpus = JSON.parse(corpusBytes);
  const intents = declareAttempts(corpus);
  await mkdir(values.out, { mode: 0o700 });
  const source = fileURLToPath(import.meta.url);
  const declaration = { schemaVersion: 1, declaredAt: new Date().toISOString(), runnerSha256: sha256(await readFile(source)), corpusSha256: sha256(corpusBytes), tarballSha256: sha256(await readFile(values.tarball)), protocol: corpus.protocol, attempts: intents };
  await writeJson(join(values.out, 'intent.json'), declaration);
  for (const intent of intents) {
    const path = join(values.out, intent.id);
    await mkdir(path);
    const scenario = corpus.scenarios.find((entry) => entry.id === intent.scenarioId);
    for (const [index, message] of scenario.messages.entries()) await writeFile(join(path, `input-turn-${index + 1}.txt`), message);
  }
  const privateInputs = [];
  for (const host of ['cursor', 'pi']) {
    const path = values[`${host}-auth`];
    if (!(await lstat(path)).isFile()) throw new Error(`The ${host} credential input must be a regular file`);
    privateInputs.push({ host, path, bytes: await readFile(path) });
  }
  const redact = makeRedactor(privateInputs);
  const privateBytes = Object.fromEntries(privateInputs.map((entry) => [entry.host, entry.bytes]));
  const scratch = await mkdtemp(join(tmpdir(), 'pstack-corpus-'));
  await chmod(scratch, 0o700);
  const signalHandler = () => {
    for (const pid of activeGroups) signalGroup(pid, 'SIGKILL');
    void rm(scratch, { recursive: true, force: true }).finally(() => process.exit(130));
  };
  process.once('SIGINT', signalHandler);
  process.once('SIGTERM', signalHandler);
  const results = [];
  try {
    const metadata = {
      schemaVersion: 1, platform: process.platform, arch: process.arch, node: process.version,
      runner: { path: source, sha256: declaration.runnerSha256 },
      pi: await executableIdentity(values['pi-bin']), piInstallation: await piInstallation(values['pi-bin']), cursor: await executableIdentity(values['cursor-bin']), nodeExecutable: await executableIdentity(process.execPath),
      model: MODEL, modelTimeoutMs: MODEL_TIMEOUT_MS, setupTimeoutMs: SETUP_TIMEOUT_MS, referencePlugins: [],
      executionPolicy: { retries: 0, allDeclaredAttemptsRetained: true, promptBytesUnchanged: true, independentHomePerHostAttempt: true },
      argv: argv.map((value) => redact(value)),
      comparability: { status: 'UNVERIFIED', unknownControls: ['Underlying provider routing and model build identity', 'Temperature, top-p and seed', 'Provider-side reasoning budget beyond the named medium setting', 'Effective context window and output cap', 'Host system prompts, tools and skill expansion differ by design'], matchingSelectorsAloneEstablishParity: false },
    };
    const env = hostEnv(join(scratch, 'versions'), 'pi');
    await mkdir(env.TMPDIR, { recursive: true });
    for (const host of ['pi', 'cursor']) {
      const version = await runProcess(values[`${host}-bin`], ['--version'], { cwd: scratch, env, prefix: join(values.out, `${host}-version`), redact });
      metadata[host].versionOutput = version.stdout.trim();
      metadata[host].versionExit = version.exit;
    }
    for (const [index, plugin] of values['plugin-root'].entries()) {
      const command = await runProcess('git', ['-C', resolve(plugin), 'rev-parse', 'HEAD'], { cwd: scratch, env, prefix: join(values.out, `plugin-${index + 1}-revision`), redact });
      if (command.exit.code !== 0 || command.stdout.trim() !== corpus.sourceRevision) throw new Error('Reference plugins do not match the corpus source revision');
      const status = await runProcess('git', ['-C', resolve(plugin), 'status', '--porcelain=v1', '-uall', '--', '.'], { cwd: scratch, env, prefix: join(values.out, `plugin-${index + 1}-status`), redact });
      if (status.exit.code !== 0 || status.stdout.trim() !== '') throw new Error('Reference plugin directory has local changes');
      metadata.referencePlugins.push({ root: resolve(plugin), revision: command.stdout.trim(), clean: true });
    }
    await writeJson(join(values.out, 'metadata.json'), metadata);
    for (const intent of intents) {
      const scenario = corpus.scenarios.find((entry) => entry.id === intent.scenarioId);
      const pair = { id: intent.id, ordinal: intent.ordinal, order: intent.order, scenarioId: scenario.id, repeat: intent.repeat, hosts: {}, semanticStatus: 'PENDING_INDEPENDENT_REVIEW', comparability: 'UNVERIFIED' };
      for (const host of intent.order) {
        console.log(`${intent.id} ${host} started`);
        pair.hosts[host] = await runHost(host, intent, scenario, values, scratch, redact, privateBytes);
        console.log(`${intent.id} ${host} ${pair.hosts[host].automatic.status}`);
      }
      pair.identicalInitialTrees = pair.hosts.cursor.before?.tree === pair.hosts.pi.before?.tree && Boolean(pair.hosts.pi.before?.tree);
      pair.identicalInitialFiles = JSON.stringify(pair.hosts.cursor.before?.files) === JSON.stringify(pair.hosts.pi.before?.files) && Boolean(pair.hosts.pi.before?.files);
      await writeJson(join(values.out, intent.id, 'pair.json'), pair);
      results.push(pair);
    }
  } finally {
    for (const pid of activeGroups) signalGroup(pid, 'SIGKILL');
    await rm(scratch, { recursive: true, force: true });
    process.removeListener('SIGINT', signalHandler);
    process.removeListener('SIGTERM', signalHandler);
    await writeJson(join(values.out, 'cleanup.json'), { completedAt: new Date().toISOString(), disposableRootRemoved: true, noPrivateProfilesRetained: true, sourceCredentialsNeverModifiedByRunner: true });
  }
  const manifest = await artifactManifest(values.out);
  await writeJson(join(values.out, 'artifact-manifest.json'), manifest);
  const hosts = results.flatMap((pair) => Object.values(pair.hosts));
  const summary = {
    schemaVersion: 1, scope: corpus.scope, evidenceDirectory: values.out, completedAt: new Date().toISOString(),
    declaredPairs: intents.length, executedPairs: results.length, attemptedHostSetups: hosts.length,
    executedHostAttempts: hosts.filter((host) => host.turns.some((turn) => turn.exit)).length,
    invokedModelTurns: hosts.reduce((count, host) => count + host.turns.filter((turn) => turn.exit).length, 0),
    completedModelTurns: hosts.reduce((count, host) => count + host.turns.filter((turn) => turn.parsed?.completed).length, 0),
    automaticPrechecks: Object.fromEntries(['PASS', 'FAIL', 'UNVERIFIED'].map((status) => [status, hosts.filter((host) => host.automatic.status === status).length])),
    semanticStatus: 'PENDING_INDEPENDENT_REVIEW', comparability: 'UNVERIFIED', overallParityClaim: false,
    sourceDigests: { runner: declaration.runnerSha256, corpus: declaration.corpusSha256, tarball: declaration.tarballSha256 },
    artifactManifestSha256: sha256(await readFile(join(values.out, 'artifact-manifest.json'))), artifactCount: manifest.length,
    failedPrechecks: results.flatMap((pair) => Object.entries(pair.hosts).filter(([, host]) => host.automatic.status !== 'PASS').map(([name, host]) => ({ pair: pair.id, host: name, setup: host.setup, error: host.error, checks: host.automatic.checks.filter((check) => check.status !== 'PASS') }))),
    initialFixturesIdentical: results.every((pair) => pair.identicalInitialTrees && pair.identicalInitialFiles),
    modelIdentities: Object.fromEntries(['cursor', 'pi'].map((name) => [name, [...new Map(results.flatMap((pair) => pair.hosts[name].turns.flatMap((turn) => turn.parsed?.identities ?? [])).map((identity) => [JSON.stringify(identity), identity])).values()]])),
    reviewFiles: results.map((pair) => ({ pair: pair.id, rubric: `${values.corpus}#${pair.scenarioId}`, cursor: `${pair.id}/cursor/result.json`, pi: `${pair.id}/pi/result.json` })),
    limitations: ['Only five fixed scenarios with three repeats each were executed. This is not complete source coverage.', 'Text-presence checks are literal prechecks, not semantic passes.', 'Comparable inference controls remain unverified.', 'No timing or performance comparison is claimed.', 'Raw events exclude private credential values. Private homes and configs are not evidence.', 'No inherited MCP profiles, external-service credentials or user model rules were loaded. No live service workflows were exercised.'],
  };
  await writeJson(join(values.out, 'run-summary.json'), summary);
  if (values['summary-prefix']) {
    const receipt = { ...summary, runSummarySha256: sha256(await readFile(join(values.out, 'run-summary.json'))), testsSha256: sha256(await readFile(join(dirname(source), 'corpus-runner.test.mjs'))) };
    await writeJson(`${values['summary-prefix']}.json`, receipt);
    await writeFile(`${values['summary-prefix']}.md`, `# Baseline corpus execution\n\nRun the fixed prompts against official Cursor pstack and the packed pi-pstack baseline.\n\nExecuted ${summary.executedPairs}/${summary.declaredPairs} pairs and ${summary.executedHostAttempts} host attempts. Deterministic prechecks returned ${summary.automaticPrechecks.PASS} PASS, ${summary.automaticPrechecks.FAIL} FAIL and ${summary.automaticPrechecks.UNVERIFIED} UNVERIFIED. These are not semantic verdicts.\n\nSemantic review is pending. Model comparability is UNVERIFIED. No overall parity or complete source coverage is claimed.\n\nEvidence is in \`${values.out}\`. Review each host's \`result.json\`, \`turn-*-final.txt\` and \`turn-*.stdout\` against the unchanged rubric in \`corpus.json\`. All declared failures remain in the evidence.\n\nThe JSON summary binds the runner, tests, corpus, tarball, run summary and artifact manifest with SHA-256 digests. Private profiles and copied credentials were removed.\n`);
  }
  console.log(JSON.stringify({ executedPairs: summary.executedPairs, automaticPrechecks: summary.automaticPrechecks, semanticStatus: summary.semanticStatus, comparability: summary.comparability, evidenceDirectory: values.out }));
  return summary;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).then((summary) => {
    if (summary.automaticPrechecks.FAIL) process.exitCode = 2;
  }).catch((error) => { console.error(error.message); process.exitCode = 1; });
}
