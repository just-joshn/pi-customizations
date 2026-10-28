import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync } from 'node:fs';
import { copyFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Pi loads a local package in place without installing dependencies, and it
// installs npm packages with peers disabled. Each package must therefore load
// from a copy without node_modules, using only the modules Pi supplies.
const root = fileURLToPath(new URL('..', import.meta.url));
const cli = join(root, 'extensions/pi-pstack/node_modules/@earendil-works/pi-coding-agent/dist/bundle/cli.js');
const providers = [
  { dir: 'extensions/pi-anthropic-oauth', provider: 'claude-subscription' },
  { dir: 'extensions/pi-antigravity-oauth', provider: 'google-antigravity' },
  { dir: 'extensions/pi-xai-oauth', provider: 'grok-build' },
];

function copyableFile(path) {
  try {
    const stat = lstatSync(path);
    // Follow neither broken symlinks nor gitlinks/submodule directories.
    return stat.isFile();
  } catch {
    return false;
  }
}

async function exportWorkingTree(target) {
  const listing = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { cwd: root });
  for (const file of listing.toString().split('\0').filter(Boolean)) {
    // Fresh-install proves package load from a clean tree. Parity research trees are out of that contract.
    if (file === 'parity' || file.startsWith('parity/')) continue;
    const source = join(root, file);
    if (!copyableFile(source)) continue;
    await mkdir(dirname(join(target, file)), { recursive: true });
    await copyFile(source, join(target, file));
  }
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

function listModels(agentDir, packageDir, provider) {
  const output = execFileSync(process.execPath, [cli, '--no-extensions', '-e', packageDir, '--list-models', provider], {
    cwd: agentDir,
    env: { ...process.env, PI_CODING_AGENT_DIR: agentDir },
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return output.split('\n').filter((line) => line.startsWith(`${provider} `)).length;
}

const workspace = await mkdtemp(join(tmpdir(), 'pi-fresh-install-'));
try {
  const tree = join(workspace, 'tree');
  const agentDir = join(workspace, 'agent');
  await mkdir(agentDir);
  await exportWorkingTree(tree);
  await writeFixtureCredentials(agentDir);
  for (const { dir, provider } of providers) {
    assert.ok(!existsSync(join(tree, dir, 'node_modules')), `${dir} export must not contain node_modules`);
    const count = listModels(agentDir, join(tree, dir), provider);
    assert.ok(count > 0, `${dir} registers ${provider} models when loaded from a fresh copy`);
    process.stdout.write(`${dir}: ${count} ${provider} models from a fresh copy\n`);
  }
} finally {
  await rm(workspace, { recursive: true, force: true });
}
