#!/usr/bin/env node
import { strict as assert } from 'node:assert';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { API } from 'typescript/unstable/sync';
import { applySourceEdits, indexSignatureEdits } from './migrate-index-signature-access.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const directory = await mkdtemp(join(tmpdir(), 'index-signature-migration-'));
const api = new API({ cwd: directory });
try {
  const path = join(directory, 'fixture.ts');
  const configPath = join(directory, 'tsconfig.json');
  await writeFile(configPath, JSON.stringify({ extends: join(root, 'tsconfig.json'), compilerOptions: { typeRoots: [join(root, 'node_modules/@types')] }, files: ['fixture.ts'], include: [], exclude: [] }));
  const input = [
    'declare const row: Record<string, string>;',
    'declare const optional: Record<string, string> | undefined;',
    'declare const declared: { name: string };',
    'row.name; row.name;',
    'optional?.name;',
    '(row).name;',
    'row /* receiver */ . /* key */ name;',
    'row.default;',
    'row.$value;',
    'row.名前;',
    'declared.name;',
    '',
  ].join('\n');
  await writeFile(path, input);
  const snapshot = api.updateSnapshot({ openProjects: [configPath] });
  try {
    const project = snapshot.getProject(configPath);
    assert.ok(project, 'compiler opens the controlled project');
    const source = project.program.getSourceFile(path);
    assert.ok(source, 'compiler reads the controlled source');
    const diagnostics = project.program.getSemanticDiagnostics().filter((item) => item.code === 4111 && item.fileName === path);
    assert.equal(diagnostics.length, 8, 'compiler identifies index-signature accesses and leaves the declared field alone');
    const edits = indexSignatureEdits(source, diagnostics);
    assert.equal(edits.length, diagnostics.length, 'every compiler diagnostic has exactly one edit');
    const expected = `declare const row: Record<string, string>;
declare const optional: Record<string, string> | undefined;
declare const declared: { name: string };
row['name']; row['name'];
optional?.['name'];
(row)['name'];
row /* receiver */ [ /* key */ 'name'];
row['default'];
row['$value'];
row['名前'];
declared.name;
`;
    const output = applySourceEdits(input, edits);
    assert.equal(output, expected, 'preserve receivers, optional access, declared fields and comments');
    assert.deepEqual(indexSignatureEdits({ ...source, fileName: 'vitest.config.ts' }, diagnostics), [], 'protected paths never produce edits');
    await writeFile(path, output);
  } finally {
    snapshot.dispose();
  }
  const migrated = api.updateSnapshot({ fileChanges: { changed: [path] } });
  try {
    const project = migrated.getProject(configPath);
    assert.ok(project);
    assert.deepEqual(project.program.getSemanticDiagnostics(), [], 'the fixture complies with the actual root compiler policy');
    const source = project.program.getSourceFile(path);
    assert.ok(source);
    assert.deepEqual(indexSignatureEdits(source, []), [], 'a second pass is idempotent');
  } finally {
    migrated.dispose();
  }
  assert.throws(
    () =>
      applySourceEdits('abc', [
        { start: 0, length: 2, replacement: '' },
        { start: 1, length: 1, replacement: '' },
      ]),
    /overlap/,
    'overlapping edits cannot silently corrupt a file',
  );
} finally {
  api.close();
  await rm(directory, { recursive: true, force: true });
}
process.stdout.write('Index-signature migration self-test passed.\n');
