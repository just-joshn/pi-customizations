import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');

export function teamKitSource(entry, live, records) {
  const record = records.find((candidate) => candidate.path === entry.path);
  if (!record) {
    if (sha(live) !== entry.sha256) throw new Error(`Upstream hash mismatch: upstream-team-kit/${entry.path}`);
    return live;
  }
  const original = Buffer.from(record.original, 'utf8');
  const adapted = Buffer.from(record.adapted, 'utf8');
  if (sha(original) !== record.originalSha256 || record.originalSha256 !== entry.sha256) throw new Error(`Team-kit canonical source mismatch: ${entry.path}`);
  if (sha(adapted) !== record.adaptedSha256 || !live.equals(adapted)) throw new Error(`Team-kit adapted source mismatch: ${entry.path}`);
  return adapted;
}

export async function teamKitRecords(root) {
  const records = JSON.parse(await readFile(join(root, 'scripts/team-kit-source-adaptations.json'), 'utf8'));
  if (!Array.isArray(records) || new Set(records.map((record) => record.path)).size !== records.length) throw new Error('Invalid team-kit adaptation records.');
  const inventory = JSON.parse(await readFile(join(root, 'docs/team-kit-source-inventory.json'), 'utf8'));
  for (const record of records) {
    if (!inventory.some((entry) => entry.path === record.path)) throw new Error(`Unknown team-kit adaptation: ${record.path}`);
  }
  return records;
}

if (import.meta.main) {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const inventory = JSON.parse(await readFile(join(root, 'docs/team-kit-source-inventory.json'), 'utf8'));
  const records = await teamKitRecords(root);
  const pinnedIndex = process.argv.indexOf('--pinned');
  if (pinnedIndex !== -1) {
    const repository = process.argv[pinnedIndex + 1];
    if (!repository) throw new Error('--pinned requires the original plugins checkout.');
    const provenance = JSON.parse(await readFile(join(root, 'docs/provenance.json'), 'utf8'))['team-kit'];
    for (const record of records) {
      const path = record.path.replace('plugin-metadata/', '.cursor-plugin/');
      const original = execFileSync('git', ['-C', repository, 'show', `${provenance.commit}:cursor-team-kit/${path}`], { encoding: 'utf8' });
      const normalized = original
        .replaceAll('Cursor Team Kit', 'Team Kit')
        .replaceAll('Cursor', 'Reference')
        .replaceAll('cursor-team-kit', 'team-kit')
        .replaceAll('.cursor', '.upstream')
        .replaceAll('@cursor-skill', '@upstream-skill')
        .replaceAll('https://github.com/cursor/plugins', 'the upstream plugins repository')
        .replace(/\bcursor\b/g, 'reference');
      if (normalized !== record.original) throw new Error(`Pinned team-kit original mismatch: ${record.path}`);
    }
  }
  for (const entry of inventory) teamKitSource(entry, await readFile(join(root, 'upstream-team-kit', entry.path)), records);
  process.stdout.write(`Verified ${inventory.length} canonical normalized team-kit sources and ${records.length} adaptations.\n`);
}
