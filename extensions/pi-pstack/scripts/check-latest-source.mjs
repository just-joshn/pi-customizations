import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
try {
  const args = process.argv.slice(2).filter((arg) => arg !== '--current');
  const repo = resolve(args[0] ?? join(homedir(), 'src/experiments/plugins'));
  const { pstack } = JSON.parse(await readFile(join(root, 'docs/provenance.json'), 'utf8'));
  if (!/^[a-f0-9]{40}$/.test(pstack.commit) || pstack.path !== 'pstack') throw new Error('Invalid pinned pstack provenance.');
  if (process.argv.includes('--current')) {
    const dirty = execFileSync('git', ['-C', repo, 'status', '--porcelain', '--untracked-files=all', '--', 'pstack'], { encoding: 'utf8' }).trim();
    if (dirty) throw new Error('Authoritative pstack checkout has uncommitted changes.');
    const changed = execFileSync('git', ['-C', repo, 'diff', '--name-only', pstack.commit, 'HEAD', '--', 'pstack'], { encoding: 'utf8' }).trim();
    if (changed) throw new Error('Pinned pstack source differs from the current authoritative tree.');
  }
  const paths = execFileSync('git', ['-C', repo, 'ls-tree', '-r', '--name-only', pstack.commit, '--', 'pstack'], { encoding: 'utf8' }).trim().split('\n');
  if (!paths.length || paths.some((path) => !path.startsWith('pstack/'))) throw new Error('Pinned source tree is empty or invalid.');
  const inventory = JSON.parse(await readFile(join(root, 'docs/source-inventory.json'), 'utf8'));
  const expected = new Set(inventory.map((entry) => entry.path));
  let findings = [];
  const sourcePaths = new Set(paths.map((path) => path.slice('pstack/'.length).replace('.cursor-plugin/', 'plugin-metadata/')));
  const legacyLowercase = new Set(['automations/benny/FOR_AGENTS.md', 'automations/benny/README.md']);
  for (const path of paths) {
    const relative = path.slice('pstack/'.length).replace('.cursor-plugin/', 'plugin-metadata/');
    if (!expected.has(relative)) findings = [...findings, `Source is not inventoried: ${relative}`];
    const source = execFileSync('git', ['-C', repo, 'show', `${pstack.commit}:${path}`]);
    const text = source.toString('utf8');
    const generic = text.replaceAll('Cursor', 'Reference').replaceAll('cursor-team-kit', 'team-kit').replaceAll('.cursor', '.upstream').replaceAll('@cursor-skill', '@upstream-skill');
    const legacy = legacyLowercase.has(relative) ? generic.replace(/\bcursor\b/g, 'reference') : generic;
    const corrected = relative.startsWith('skills/poteto-mode/scripts/watch-pr/') ? legacy.replaceAll('endReference', 'endCursor') : legacy;
    const normalized = Buffer.from(text).equals(source) ? Buffer.from(corrected) : source;
    const snapshot = await readFile(join(root, 'upstream', relative));
    if (!normalized.equals(snapshot)) findings = [...findings, `Normalized source differs: ${relative}`];
  }
  for (const path of expected) if (!sourcePaths.has(path)) findings = [...findings, `Inventory has no pinned source: ${path}`];
  if (findings.length) throw new Error(findings.join('\n'));
  process.stdout.write(`Verified ${paths.length} normalized pstack source files against ${pstack.commit}.\n`);
} catch (error) {
  process.stderr.write(`${String(error)}\n`);
  process.exitCode = 1;
}
