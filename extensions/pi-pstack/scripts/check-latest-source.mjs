import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');

async function testMigrations() {
  let records;
  try {
    records = JSON.parse(await readFile(join(root, 'docs/vitest-source-migration.json'), 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
  const pathPattern = /^skills\/poteto-mode\/scripts\/(?:package\.json|bun\.lock|watch-pr\/tsconfig\.json|(?:bootstrap|(?:orch|watch-pr)\/[a-z-]+(?:\.[a-z-]+)?)\.ts)$/;
  const formatOnlyPaths = new Set(['plugin-metadata/plugin.json', 'skills/poteto-mode/scripts/check-plan.mjs']);
  const digest = /^[a-f0-9]{64}$/;
  const lines = (value) => Array.isArray(value) && value.every((line) => typeof line === 'string');
  if (
    !Array.isArray(records) ||
    records.some((record) => {
      if (!record || typeof record.path !== 'string' || (!pathPattern.test(record.path) && !formatOnlyPaths.has(record.path)) || !digest.test(record.sourceSha256) || !digest.test(record.migratedSha256) || !Array.isArray(record.edits))
        return true;
      if (formatOnlyPaths.has(record.path) && record.edits.length) return true;
      if (record.formatEdits !== undefined && (!Array.isArray(record.formatEdits) || !digest.test(record.adaptedSha256))) return true;
      if (!record.edits.length && !record.formatEdits?.length) return true;
      return [record.edits, record.formatEdits ?? []].some((edits) => {
        let end = 0;
        return edits.some((edit) => {
          if (!edit || !Number.isInteger(edit.offset) || edit.offset < end || !lines(edit.before) || !lines(edit.after)) return true;
          end = edit.offset + edit.before.length;
          return false;
        });
      });
    }) ||
    new Set(records.map((record) => record.path)).size !== records.length
  )
    throw new Error('Invalid test-runner source migration.');
  return records;
}

function replayMigration(source, migration) {
  if (!migration) return source;
  if (hash(source) !== migration.sourceSha256) throw new Error(`Test migration source hash differs: ${migration.path}`);
  let lines = source.toString('utf8').match(/[^\n]*\n|[^\n]+$/g) ?? [];
  for (const [stage, edits] of [migration.edits, migration.formatEdits ?? []].entries()) {
    if (stage === 1 && migration.formatEdits !== undefined && hash(Buffer.from(lines.join(''))) !== migration.adaptedSha256) throw new Error(`Compiler adaptation result hash differs: ${migration.path}`);
    for (const edit of edits.toReversed()) {
      if (edit.offset > lines.length || lines.slice(edit.offset, edit.offset + edit.before.length).join('') !== edit.before.join('')) throw new Error(`Test migration edit differs: ${migration.path}`);
      lines = [...lines.slice(0, edit.offset), ...edit.after, ...lines.slice(edit.offset + edit.before.length)];
    }
  }
  const migrated = Buffer.from(lines.join(''));
  if (hash(migrated) !== migration.migratedSha256) throw new Error(`Test migration result hash differs: ${migration.path}`);
  return migrated;
}

try {
  const repo = resolve(process.argv[2] ?? join(homedir(), 'src/experiments/plugins'));
  const { pstack } = JSON.parse(await readFile(join(root, 'docs/provenance.json'), 'utf8'));
  if (!/^[a-f0-9]{40}$/.test(pstack.commit) || pstack.path !== 'pstack') throw new Error('Invalid pinned pstack provenance.');
  const paths = execFileSync('git', ['-C', repo, 'ls-tree', '-r', '--name-only', pstack.commit, '--', 'pstack'], { encoding: 'utf8' }).trim().split('\n');
  if (!paths.length || paths.some((path) => !path.startsWith('pstack/'))) throw new Error('Pinned source tree is empty or invalid.');
  const inventory = JSON.parse(await readFile(join(root, 'docs/source-inventory.json'), 'utf8'));
  const expected = new Set(inventory.map((entry) => entry.path));
  const migrations = await testMigrations();
  let findings = [];
  const sourcePaths = new Set(paths.map((path) => path.slice('pstack/'.length).replace('.cursor-plugin/', 'plugin-metadata/')));
  const legacyLowercase = new Set(['automations/benny/FOR_AGENTS.md', 'automations/benny/README.md', 'skills/why/SKILL.md', 'skills/poteto-mode/scripts/watch-pr/github.ts', 'skills/poteto-mode/scripts/watch-pr/github.test.ts']);
  for (const path of paths) {
    const relative = path.slice('pstack/'.length).replace('.cursor-plugin/', 'plugin-metadata/');
    if (!expected.has(relative)) findings = [...findings, `Source is not inventoried: ${relative}`];
    const source = execFileSync('git', ['-C', repo, 'show', `${pstack.commit}:${path}`]);
    const text = source.toString('utf8');
    const generic = text.replaceAll('Cursor', 'Reference').replaceAll('cursor-team-kit', 'team-kit').replaceAll('.cursor', '.upstream').replaceAll('@cursor-skill', '@upstream-skill');
    const legacy = legacyLowercase.has(relative) ? generic.replace(/\bcursor\b/g, 'reference') : generic;
    const corrected = relative.startsWith('skills/poteto-mode/scripts/watch-pr/') ? legacy.replaceAll('endReference', 'endCursor') : legacy;
    const normalized = replayMigration(
      Buffer.from(text).equals(source) ? Buffer.from(corrected) : source,
      migrations.find((migration) => migration.path === relative),
    );
    const snapshot = await readFile(join(root, 'upstream', relative));
    if (!normalized.equals(snapshot)) findings = [...findings, `Normalized source differs: ${relative}`];
  }
  for (const path of expected) if (!sourcePaths.has(path)) findings = [...findings, `Inventory has no pinned source: ${path}`];
  for (const migration of migrations) if (!sourcePaths.has(migration.path)) findings = [...findings, `Test migration has no pinned source: ${migration.path}`];
  if (findings.length) throw new Error(findings.join('\n'));
  process.stdout.write(`Verified ${paths.length} normalized pstack source files against ${pstack.commit}.\n`);
} catch (error) {
  process.stderr.write(`${String(error)}\n`);
  process.exitCode = 1;
}
