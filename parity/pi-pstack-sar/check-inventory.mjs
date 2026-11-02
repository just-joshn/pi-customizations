import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const source = process.argv[2];
if (source === undefined) throw new Error('Pass the cursor/plugins checkout to inspect its pinned git objects.');
const target = fileURLToPath(new URL('../../extensions/pi-pstack/', import.meta.url));
const manifest = JSON.parse(readFileSync(resolve(target, 'package.json'), 'utf8'));
const provenance = manifest.pstackSource;
const git = (...args) => execFileSync('git', ['-C', source, ...args]);
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const omitted = new Map([
  ['.cursor-plugin/plugin.json', 'Pi discovers resources through package.json.'],
  ['plugin.json', 'Pi discovers resources through package.json.'],
  ['.gitignore', 'Repository ignore policy is not a plugin capability.'],
  ['docs/harness/claude-code.md', 'The Claude Code adapter does not apply to Pi.'],
]);
const entries = git('ls-tree', '-r', provenance.revision, '--', provenance.path).toString('utf8').trim().split('\n');
const files = entries.map((line) => {
  const [metadata, path] = line.split('\t');
  const relative = path.slice(provenance.path.length + 1);
  const original = git('show', `${provenance.revision}:${path}`);
  const local = resolve(target, relative);
  const base = { path: relative, sourceSha256: hash(original), sourceExecutable: metadata.startsWith('100755 ') };
  if (!existsSync(local)) return { ...base, status: omitted.has(relative) ? 'host-specific omission' : 'MISSING', reason: omitted.get(relative) };
  const bytes = readFileSync(local);
  return {
    ...base,
    targetSha256: hash(bytes),
    targetExecutable: (statSync(local).mode & 0o111) !== 0,
    status: bytes.equals(original) ? 'identical' : 'changed; semantic review required',
  };
});
const errors = files.filter((file) => file.status === 'MISSING' || (file.targetExecutable !== undefined && file.sourceExecutable !== file.targetExecutable));
const counts = Object.fromEntries([...new Set(files.map((file) => file.status))].map((status) => [status, files.filter((file) => file.status === status).length]));
console.log(JSON.stringify({ provenance, counts, errors, files }, null, 2));
if (errors.length > 0) process.exitCode = 1;
