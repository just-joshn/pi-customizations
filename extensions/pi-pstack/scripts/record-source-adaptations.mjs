import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const repo = resolve(process.argv[2] ?? '');
const adaptedDirectory = process.argv[3];
if (!adaptedDirectory) throw new Error('Pass the pinned Git checkout and the preformat upstream directory.');
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const lines = (bytes) => bytes.toString('utf8').match(/[^\n]*\n|[^\n]+$/g) ?? [];
const { pstack } = JSON.parse(await readFile(join(root, 'docs/provenance.json'), 'utf8'));
const inventory = JSON.parse(await readFile(join(root, 'docs/source-inventory.json'), 'utf8'));
const scratch = await mkdtemp(join(tmpdir(), 'pstack-source-edits-'));
const legacyLowercase = new Set(['automations/benny/FOR_AGENTS.md', 'automations/benny/README.md', 'skills/why/SKILL.md', 'skills/poteto-mode/scripts/watch-pr/github.ts', 'skills/poteto-mode/scripts/watch-pr/github.test.ts']);

async function edits(before, after) {
  if (before.equals(after)) return [];
  const from = join(scratch, 'before');
  const to = join(scratch, 'after');
  await writeFile(from, before);
  await writeFile(to, after);
  let diff;
  try {
    diff = execFileSync('git', ['diff', '--no-index', '--no-ext-diff', '--unified=0', from, to], { encoding: 'utf8' });
  } catch (error) {
    if (error.status !== 1 || typeof error.stdout !== 'string') throw error;
    diff = error.stdout;
  }
  const oldLines = lines(before);
  const newLines = lines(after);
  const result = [...diff.matchAll(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/gm)].map((match) => {
    const count = Number(match[2] ?? 1);
    const replacementCount = Number(match[4] ?? 1);
    const offset = Number(match[1]) - (count === 0 ? 0 : 1);
    const replacementOffset = Number(match[3]) - (replacementCount === 0 ? 0 : 1);
    return { offset, before: oldLines.slice(offset, offset + count), after: newLines.slice(replacementOffset, replacementOffset + replacementCount) };
  });
  let replay = oldLines;
  for (const edit of result.toReversed()) replay = [...replay.slice(0, edit.offset), ...edit.after, ...replay.slice(edit.offset + edit.before.length)];
  if (replay.join('') !== after.toString('utf8')) throw new Error('Source edit generation did not reproduce the complete bytes.');
  return result;
}

try {
  const records = [];
  const updatedInventory = [];
  for (const entry of inventory) {
    const gitPath = entry.path.replace('plugin-metadata/', '.cursor-plugin/');
    const original = execFileSync('git', ['-C', repo, 'show', `${pstack.commit}:pstack/${gitPath}`]);
    const text = original.toString('utf8');
    const generic = text.replaceAll('Cursor', 'Reference').replaceAll('cursor-team-kit', 'team-kit').replaceAll('.cursor', '.upstream').replaceAll('@cursor-skill', '@upstream-skill');
    const legacy = legacyLowercase.has(entry.path) ? generic.replace(/\bcursor\b/g, 'reference') : generic;
    const corrected = entry.path.startsWith('skills/poteto-mode/scripts/watch-pr/') ? legacy.replaceAll('endReference', 'endCursor') : legacy;
    const baseline = Buffer.from(text).equals(original) ? Buffer.from(corrected) : original;
    const adapted = await readFile(join(adaptedDirectory, entry.path));
    const snapshot = await readFile(join(root, 'upstream', entry.path));
    const compilerEdits = await edits(baseline, adapted);
    const formatEdits = await edits(adapted, snapshot);
    if (compilerEdits.length || formatEdits.length)
      records.push({
        path: entry.path,
        sourceSha256: hash(baseline),
        edits: compilerEdits,
        ...(formatEdits.length ? { adaptedSha256: hash(adapted), formatEdits } : {}),
        migratedSha256: hash(snapshot),
      });
    updatedInventory.push({ ...entry, bytes: snapshot.length, sha256: hash(snapshot) });
  }
  await writeFile(join(root, 'docs/vitest-source-migration.json'), `${JSON.stringify(records, null, 2)}\n`);
  await writeFile(join(root, 'docs/source-inventory.json'), `${JSON.stringify(updatedInventory, null, 2)}\n`);
  execFileSync(join(root, '../../node_modules/.bin/biome'), ['check', '--write', join(root, 'docs/vitest-source-migration.json'), join(root, 'docs/source-inventory.json')], { cwd: join(root, '../..'), stdio: 'pipe' });
  process.stdout.write(`Recorded ${records.length} exact source adaptations across ${inventory.length} pinned paths.\n`);
} finally {
  await rm(scratch, { recursive: true, force: true });
}
