#!/usr/bin/env node
import { strict as assert } from 'node:assert';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { inspectTypeScriptPolicy } from './check-typescript-policy.mjs';

const directory = await mkdtemp(join(tmpdir(), 'typescript-policy-'));
try {
  const authority = fileURLToPath(new URL('../tsconfig.json', import.meta.url));
  await mkdir(join(directory, 'src'));
  await mkdir(join(directory, 'helpers'));
  await writeFile(join(directory, 'src/index.ts'), 'export const value = 1;\n');
  await writeFile(join(directory, 'helpers/tool.test.ts'), 'export const value = 2;\n');
  await writeFile(join(directory, 'tsconfig.json'), JSON.stringify({ extends: authority, include: ['**/*.ts'], exclude: ['**/node_modules/**'] }));
  await writeFile(join(directory, 'helpers/tsconfig.json'), JSON.stringify({ extends: '../tsconfig.json', compilerOptions: { types: ['node', 'bun-types'] }, include: ['*.ts'] }));
  assert.deepEqual((await inspectTypeScriptPolicy(directory)).failures, [], 'scope and runtime declarations do not duplicate compiler policy');
  await writeFile(join(directory, 'helpers/tsconfig.json'), JSON.stringify({ extends: '../tsconfig.json', compilerOptions: { noUncheckedIndexedAccess: false }, include: ['*.ts'] }));
  const weakened = await inspectTypeScriptPolicy(directory);
  assert.ok(
    weakened.failures.some((item) => item.includes('noUncheckedIndexedAccess')),
    'an overridden safety flag fails the gate',
  );
  await writeFile(join(directory, 'helpers/tsconfig.json'), JSON.stringify({ extends: '../tsconfig.json', include: ['*.ts'] }));
  await writeFile(join(directory, 'tsconfig.json'), JSON.stringify({ extends: authority, include: ['src/**/*.ts'], exclude: ['**/node_modules/**'] }));
  const missing = await inspectTypeScriptPolicy(directory);
  assert.ok(missing.failures.includes('Root compiler does not select helpers/tool.test.ts'), 'a leaf cannot hide an omitted root source');
} finally {
  await rm(directory, { recursive: true, force: true });
}
process.stdout.write('TypeScript policy self-test passed.\n');
