import { createHash } from 'node:crypto';
import { lstat, readdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

async function inventory(path) {
  const info = await lstat(path);
  if (info.isSymbolicLink()) return [{ path, type: 'symlink', state: 'UNREVIEWED' }];
  if (info.isDirectory()) {
    const names = (await readdir(path)).filter((name) => !['.git', 'node_modules', '.DS_Store'].includes(name)).toSorted();
    return (await Promise.all(names.map((name) => inventory(join(path, name))))).flat();
  }
  if (!info.isFile()) throw new Error(`Unsupported source entry: ${path}`);
  const bytes = await readFile(path);
  const lines = path.endsWith('.md')
    ? bytes
        .toString('utf8')
        .split('\n')
        .flatMap((text, index) => (text.trim() ? [{ line: index + 1, text, state: 'UNREVIEWED' }] : []))
    : [];
  return [{ path, type: 'file', sha256: createHash('sha256').update(bytes).digest('hex'), lines }];
}

try {
  const roots = process.argv
    .slice(2)
    .map((path) => resolve(path))
    .toSorted();
  if (!roots.length) throw new Error('Usage: source-census.mjs <authoritative-source-path> [...]');
  const files = (await Promise.all(roots.map(inventory))).flat();
  process.stdout.write(`${JSON.stringify({ verdict: 'NOT VERIFIED', scope: 'Source inventory and unreviewed Markdown lines. Hashes and extraction do not establish behavioral parity.', roots, files }, null, 2)}\n`);
} catch (error) {
  process.stderr.write(`${String(error)}\n`);
  process.exitCode = 1;
}
