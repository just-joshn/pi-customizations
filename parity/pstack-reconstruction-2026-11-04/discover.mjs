import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const output = dirname(fileURLToPath(import.meta.url));
const repository = resolve(output, '../..');
const plugins = resolve(process.argv[2] ?? join(repository, '../plugins'));
const target = join(repository, 'extensions/pi-pstack');
const label = process.argv[3] ?? '';
if (!/^[a-z0-9-]*$/.test(label)) throw new Error('A snapshot label may contain only lowercase letters, digits, and hyphens.');
const suffix = label === '' ? '' : `-${label}`;
const files = [];
const diffs = [];
const textExtensions = /\.(?:md|mdc|ts|js|mjs|cjs|json|yaml|yml|sh|html|css|cfg|tla|toml|txt)$|(?:^|\/)(?:bun\.lock|statechart)$/;
const mechanisms = [
  'Task',
  'TodoWrite',
  'AskQuestion',
  'SwitchMode',
  'GenerateImage',
  'visualize',
  'subscribe_github_pr',
  'subscribe_timer',
  'subscribe_webhook',
  'list_subscriptions',
  'unsubscribe',
  'stop_agent',
  'agent_status',
  '/loop',
  'cursor-team-kit',
  '@cursor/sdk',
  'cursor-sdk',
  'Cursor Canvas',
  'update_state',
  'SendToUser',
  'cursor-subscriptions',
  '/automate',
  '/visualize',
];

function walk(root) {
  return readdirSync(root, { withFileTypes: true })
    .flatMap((entry) => {
      if (['node_modules', '.git', 'coverage'].includes(entry.name)) return [];
      const path = join(root, entry.name);
      return entry.isDirectory() ? walk(path) : [path];
    })
    .sort();
}

for (const plugin of ['pstack', 'cursor-team-kit', 'cursor-sdk']) {
  const root = join(plugins, plugin);
  for (const path of walk(root)) {
    const name = relative(root, path);
    const bytes = readFileSync(path);
    const text = textExtensions.test(name) ? bytes.toString('utf8') : undefined;
    const counterpart = plugin === 'cursor-sdk' ? undefined : join(target, name.replace(/^rules\/(.+)\.mdc$/, 'skills/$1/SKILL.md'));
    const targetBytes = counterpart && existsSync(counterpart) && statSync(counterpart).isFile() ? readFileSync(counterpart) : undefined;
    const hash = createHash('sha256').update(bytes).digest('hex');
    const adaptedHash = targetBytes && createHash('sha256').update(targetBytes).digest('hex');
    const status = counterpart === undefined ? 'dependency-candidate' : targetBytes === undefined ? 'no-counterpart' : hash === adaptedHash ? 'identical' : 'adapted';
    files.push({
      plugin,
      path: name,
      bytes: bytes.length,
      sha256: hash,
      status,
      ...(adaptedHash ? { piSha256: adaptedHash } : {}),
      mechanisms: text === undefined ? [] : mechanisms.filter((mechanism) => text.includes(mechanism)),
      dependencies: text === undefined ? [] : [...new Set([...text.matchAll(/(?:from\s+|import\s*\(|require\s*\()\s*['"]([^'"]+)['"]/g)].map((match) => match[1]))],
    });
    if (status === 'adapted' && text !== undefined && !name.includes('/test/')) {
      const diff = spawnSync('git', ['diff', '--no-index', '--', path, counterpart], { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
      if (diff.status !== 1) throw new Error(`Cannot compare ${path}: ${diff.stderr}`);
      diffs.push(diff.stdout);
    }
  }
}

const revision = execFileSync('git', ['-C', plugins, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const summary = Object.fromEntries(
  ['pstack', 'cursor-team-kit', 'cursor-sdk'].map((plugin) => [
    plugin,
    Object.fromEntries(['identical', 'adapted', 'no-counterpart', 'dependency-candidate'].map((status) => [status, files.filter((file) => file.plugin === plugin && file.status === status).length])),
  ]),
);
const hostInputs = [
  ...['loop', 'create-skill', 'automate'].map((name) => ({ role: `Cursor built-in ${name}`, path: join(homedir(), '.cursor/skills-cursor', name, 'SKILL.md') })),
  ...['1623.index.js', '7000.index.js', '6136.index.js', 'index.js'].map((name) => ({ role: 'Cursor CLI implementation', path: join(homedir(), '.local/share/cursor-agent/versions/2026.10.22-27dcf5f', name) })),
  { role: 'Cursor desktop implementation', path: '/usr/share/cursor/resources/app/out/vs/workbench/workbench.desktop.main.js' },
  ...['dist/bundle/cli.js', 'dist/core/agent-session.js', 'dist/core/session-manager.js', 'dist/core/extensions/runner.js'].map((name) => ({
    role: 'Native Pi host implementation',
    path: join(target, 'node_modules/@earendil-works/pi-coding-agent', name),
  })),
  ...['package.json', 'dist/sandbox/linux-sandbox-utils.js', 'dist/sandbox/generate-seccomp-filter.js', `vendor/seccomp/${process.arch}/apply-seccomp`].map((name) => ({
    role: 'Native Pi sandbox dependency',
    path: join(target, 'node_modules/@anthropic-ai/sandbox-runtime', name),
  })),
].map((input) => ({ ...input, ...(existsSync(input.path) ? { sha256: createHash('sha256').update(readFileSync(input.path)).digest('hex') } : { unavailable: true }) }));
const nativeFiles = execFileSync('git', ['-C', repository, 'ls-files', '--cached', '--others', '--exclude-standard', '-z', '--', 'extensions/pi-pstack'], { encoding: 'utf8' })
  .split('\0')
  .filter((name) => name !== '' && existsSync(join(repository, name)))
  .sort()
  .map((name) => {
    const bytes = readFileSync(join(repository, name));
    return { path: name, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
  });
writeFileSync(join(output, `source-inventory${suffix}.json`), `${JSON.stringify({ referenceRevision: revision, summary, hostInputs, files, nativeFiles }, null, 2)}\n`);
writeFileSync(join(output, `adaptation-diff${suffix}.patch`), diffs.join('\n'));
console.log(JSON.stringify({ referenceRevision: revision, summary, adaptationDiff: join(output, `adaptation-diff${suffix}.patch`) }, null, 2));
