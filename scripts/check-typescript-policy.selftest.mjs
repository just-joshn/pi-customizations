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
  const helper = 'extensions/pi-pstack/test/helpers';
  const native = 'extensions/pi-pstack/skills/poteto-mode/scripts';
  await mkdir(join(directory, helper), { recursive: true });
  await mkdir(join(directory, native), { recursive: true });
  await writeFile(join(directory, helper, 'contract.test.ts'), 'export const contract = 1;\n');
  await writeFile(join(directory, native, 'store.ts'), 'export const native = 1;\n');
  await writeFile(join(directory, native, 'tsconfig.json'), JSON.stringify({ compilerOptions: { strict: true } }));
  await writeFile(join(directory, 'tsconfig.json'), JSON.stringify({ extends: authority, include: ['src/**/*.ts', 'helpers/**/*.ts'], exclude: [] }));
  const exceptions = { noPropertyAccessFromIndexSignature: false, erasableSyntaxOnly: false, noUncheckedIndexedAccess: false };
  await writeFile(join(directory, helper, 'tsconfig.json'), JSON.stringify({ extends: '../../../../tsconfig.json', compilerOptions: exceptions, include: ['*.ts'] }));
  assert.deepEqual((await inspectTypeScriptPolicy(directory)).failures, [], 'native source ownership is separate and helper tests are selected by their narrow project');
  await writeFile(join(directory, helper, 'tsconfig.json'), JSON.stringify({ extends: '../../../../tsconfig.json', compilerOptions: { ...exceptions, strict: false }, include: ['*.ts'] }));
  assert.ok(
    (await inspectTypeScriptPolicy(directory)).failures.some((item) => item.includes('strict')),
    'the helper exception cannot weaken other safety flags',
  );
  await writeFile(join(directory, helper, 'tsconfig.json'), JSON.stringify({ extends: '../../../../tsconfig.json', compilerOptions: exceptions, files: [], include: [] }));
  assert.ok((await inspectTypeScriptPolicy(directory)).failures.includes(`Root compiler does not select ${helper}/contract.test.ts`), 'omitting a maintained helper test still fails');
} finally {
  await rm(directory, { recursive: true, force: true });
}
process.stdout.write('TypeScript policy self-test passed.\n');
