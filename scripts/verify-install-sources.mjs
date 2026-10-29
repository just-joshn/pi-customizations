import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { lstatSync } from 'node:fs';
import { copyFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Every extension must install from the three sources packages.md documents: npm, git, and a local path.
// The npm and git scenarios publish and serve the checkout locally, so the only network traffic is the
// npm registry proxy that installs each package's own runtime dependencies.
const root = fileURLToPath(new URL('..', import.meta.url));
const scope = '@justjoshn';
const packages = [
  { dir: 'pi-anthropic-oauth', name: `${scope}/pi-anthropic-oauth`, providers: ['claude-subscription'], commands: [] },
  { dir: 'pi-antigravity-oauth', name: `${scope}/pi-antigravity-oauth`, providers: ['google-antigravity'], commands: [{ source: 'extension', name: 'antigravity' }] },
  {
    dir: 'pi-maintainer',
    name: `${scope}/pi-maintainer`,
    providers: ['pi-maintainer'],
    commands: [{ source: 'extension', name: 'add' }],
  },
  {
    dir: 'pi-pstack',
    name: `${scope}/pi-pstack`,
    providers: [],
    commands: [
      { source: 'extension', name: 'mode' },
      { source: 'skill', name: 'skill:poteto-mode' },
    ],
  },
  {
    dir: 'pi-rea',
    name: `${scope}/pi-rea`,
    providers: [],
    commands: [
      { source: 'extension', name: 'rea' },
      { source: 'skill', name: 'skill:reverse-engineer-anything' },
      { source: 'prompt', name: 'investigate_feature' },
    ],
  },
  { dir: 'pi-xai-oauth', name: `${scope}/pi-xai-oauth`, providers: ['grok-build'], commands: [] },
];
const scenarios = [
  {
    name: 'npm',
    prepare: async (workspace) => {
      const registry = await startRegistry(workspace);
      return {
        env: { npm_config_userconfig: registry.npmrc },
        cases: [{ key: 'npm', installs: packages.map((pkg) => ({ source: `npm:${pkg.name}`, covers: [pkg] })) }],
      };
    },
  },
  {
    name: 'git',
    prepare: async (workspace) => {
      const source = await startGitServer(workspace);
      return { env: {}, cases: [{ key: 'git', installs: [{ source, covers: packages }] }] };
    },
  },
  {
    name: 'local',
    prepare: async () => ({
      env: {},
      cases: [
        { key: 'local-extensions', installs: packages.map((pkg) => ({ source: join(root, 'extensions', pkg.dir), covers: [pkg] })) },
        { key: 'local-root', installs: [{ source: root, covers: packages }] },
      ],
    }),
  },
];

const children = [];
const workspace = await mkdtemp(join(tmpdir(), 'pi-install-sources-'));

function freePort() {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolvePort(port));
    });
  });
}

async function waitForHttp(url, timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {}
    await new Promise((resolveWait) => setTimeout(resolveWait, 250));
  }
  throw new Error(`${url} did not answer within ${timeoutMs}ms`);
}

function spawnTracked(command, args, options) {
  // Detached so cleanup can kill npx's verdaccio grandchild along with the child itself.
  const child = spawn(command, args, { ...options, detached: true });
  children.push(child);
  return child;
}

async function startRegistry(target) {
  const port = await freePort();
  const config = join(target, 'verdaccio.yaml');
  await mkdir(join(target, 'storage'), { recursive: true });
  await writeFile(
    config,
    [
      `storage: ${join(target, 'storage')}`,
      'auth:',
      '  htpasswd:',
      `    file: ${join(target, 'htpasswd')}`,
      'uplinks:',
      '  npmjs:',
      '    url: https://registry.npmjs.org/',
      'packages:',
      `  '${scope}/*':`,
      '    access: $all',
      '    publish: $all',
      "  '**':",
      '    access: $all',
      '    proxy: npmjs',
      'log: { type: stdout, format: pretty, level: warn }',
      '',
    ].join('\n'),
  );
  const child = spawnTracked('npx', ['-y', 'verdaccio@6.11.1', '--config', config, '--listen', `127.0.0.1:${port}`], { stdio: ['ignore', 'pipe', 'pipe'] });
  let stderr = '';
  child.stderr.on('data', (chunk) => {
    stderr += chunk;
  });
  await waitForHttp(`http://127.0.0.1:${port}/-/ping`).catch((error) => {
    throw new Error(`${error.message}\n${stderr}`);
  });
  const response = await fetch(`http://127.0.0.1:${port}/-/user/org.couchdb.user:pi-install-sources`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'pi-install-sources', password: 'pi-install-sources' }),
  });
  const { token } = await response.json();
  const npmrc = join(target, 'npmrc');
  await writeFile(npmrc, `registry=http://127.0.0.1:${port}/\n//127.0.0.1:${port}/:_authToken=${token}\n`);
  for (const pkg of packages) {
    execFileSync('npm', ['publish', '--access', 'public'], {
      cwd: join(root, 'extensions', pkg.dir),
      env: { ...process.env, npm_config_userconfig: npmrc },
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    process.stdout.write(`ok npm published ${pkg.name}\n`);
  }
  return { npmrc };
}

function copyableFile(path) {
  try {
    return lstatSync(path).isFile();
  } catch {
    return false;
  }
}

async function startGitServer(target) {
  const served = join(target, 'srv');
  const repo = join(served, 'u/pi-customizations');
  const listing = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { cwd: root });
  for (const file of listing.toString().split('\0').filter(Boolean)) {
    // The git scenario proves installation, not parity research; parity/ dwarfs the tree and is not a package input.
    if (file === 'parity' || file.startsWith('parity/')) continue;
    if (!copyableFile(join(root, file))) continue;
    await mkdir(dirname(join(repo, file)), { recursive: true });
    await copyFile(join(root, file), join(repo, file));
  }
  execFileSync('git', ['init', '-q'], { cwd: repo });
  execFileSync('git', ['add', '-A'], { cwd: repo });
  execFileSync('git', ['-c', 'user.name=pi-install-sources', '-c', 'user.email=pi-install-sources@example.com', 'commit', '-q', '-m', 'install sources'], { cwd: repo });
  const port = await freePort();
  spawnTracked('git', ['daemon', `--base-path=${served}`, '--export-all', '--reuseaddr', '--listen=127.0.0.1', `--port=${port}`], { stdio: ['ignore', 'ignore', 'pipe'] });
  const source = `git:git://127.0.0.1:${port}/u/pi-customizations`;
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      execFileSync('git', ['ls-remote', source.slice('git:'.length)], { stdio: ['ignore', 'ignore', 'pipe'] });
      return source;
    } catch {
      await new Promise((resolveWait) => setTimeout(resolveWait, 250));
    }
  }
  throw new Error(`git daemon did not serve ${source}`);
}

async function writeFixtureCredentials(agentDir) {
  const credential = { type: 'oauth', access: 'fixture', refresh: 'fixture', expires: Date.UTC(2100, 0, 1) };
  const auth = {
    'claude-subscription': credential,
    'google-antigravity': { ...credential, projectId: 'fixture-project', email: 'fixture@example.com' },
    'grok-build': credential,
  };
  await writeFile(join(agentDir, 'auth.json'), JSON.stringify(auth), { mode: 0o600 });
}

function piEnv(agentDir, extra) {
  return { ...process.env, PI_CODING_AGENT_DIR: agentDir, ...extra };
}

function expectedSource(agentDir, source) {
  return source.startsWith('npm:') || source.startsWith('git:') ? source : relative(agentDir, resolve(source));
}

function install(agentDir, source, env) {
  execFileSync('pi', ['install', source], { cwd: agentDir, env: piEnv(agentDir, env), encoding: 'utf8', stdio: ['ignore', 'ignore', 'pipe'] });
}

function listedSources(agentDir, env) {
  const output = execFileSync('pi', ['list'], { cwd: agentDir, env: piEnv(agentDir, env), encoding: 'utf8' });
  return new Set(output.split('\n').map((line) => line.trim()));
}

function modelCount(agentDir, provider, env) {
  const output = execFileSync('pi', ['--list-models', provider], { cwd: agentDir, env: piEnv(agentDir, env), encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  return output.split('\n').filter((line) => line.startsWith(`${provider} `)).length;
}

function rpcCommands(agentDir, cwd, env) {
  const child = spawnTracked('pi', ['--mode', 'rpc', '--no-session'], { cwd, env: piEnv(agentDir, env), stdio: ['pipe', 'pipe', 'pipe'] });
  let stderr = '';
  child.stderr.on('data', (chunk) => {
    stderr += chunk;
  });
  return new Promise((resolveCommands, reject) => {
    let buffer = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`get_commands timed out. stderr: ${stderr}`));
    }, 60_000);
    child.on('exit', (code, signal) => {
      clearTimeout(timer);
      reject(new Error(`pi --mode rpc exited (${code ?? signal}). stderr: ${stderr}`));
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.stdout.on('data', (chunk) => {
      buffer += chunk;
      let newline = buffer.indexOf('\n');
      while (newline !== -1) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        newline = buffer.indexOf('\n');
        let message;
        try {
          message = JSON.parse(line);
        } catch {
          continue;
        }
        if (message.type !== 'response' || message.command !== 'get_commands') continue;
        clearTimeout(timer);
        child.kill('SIGKILL');
        if (!message.success) reject(new Error(`get_commands failed: ${message.error}`));
        else resolveCommands(message.data.commands);
      }
    });
    child.stdin.write(`${JSON.stringify({ id: '1', type: 'get_commands' })}\n`);
  });
}

try {
  const cwd = join(workspace, 'cwd');
  await mkdir(cwd, { recursive: true });
  execFileSync('git', ['init', '-q'], { cwd });
  await writeFile(join(cwd, '.gitignore'), '.pi-maintainer*\n');

  for (const scenario of scenarios) {
    const { env, cases } = await scenario.prepare(workspace);
    for (const testCase of cases) {
      const agentDir = join(workspace, testCase.key, 'agent');
      await mkdir(agentDir, { recursive: true });
      await writeFixtureCredentials(agentDir);
      for (const entry of testCase.installs) install(agentDir, entry.source, env);
      const sources = listedSources(agentDir, env);
      for (const entry of testCase.installs) {
        const expected = expectedSource(agentDir, entry.source);
        assert.ok(sources.has(expected), `pi list shows ${expected}`);
        process.stdout.write(`ok ${scenario.name} pi list shows ${expected}\n`);
      }
      const commands = await rpcCommands(agentDir, cwd, env);
      for (const entry of testCase.installs) {
        const expected = expectedSource(agentDir, entry.source);
        for (const pkg of entry.covers) {
          for (const command of pkg.commands) {
            const found = commands.find((candidate) => candidate.source === command.source && candidate.name === command.name && candidate.sourceInfo?.source === expected);
            assert.ok(found, `${pkg.name} provides ${command.source} ${command.name} from ${expected}`);
            process.stdout.write(`ok ${scenario.name} ${pkg.name} provides ${command.source} ${command.name} from ${expected}\n`);
          }
          for (const provider of pkg.providers) {
            const count = modelCount(agentDir, provider, env);
            assert.ok(count > 0, `${pkg.name} registers ${provider} models`);
            process.stdout.write(`ok ${scenario.name} ${pkg.name} registers ${count} ${provider} models\n`);
          }
        }
      }
    }
  }
} finally {
  for (const child of children) {
    try {
      process.kill(-child.pid, 'SIGKILL');
    } catch {}
  }
  await rm(workspace, { recursive: true, force: true });
}
