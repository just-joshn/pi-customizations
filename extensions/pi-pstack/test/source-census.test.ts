import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, test } from 'vitest';

const script = fileURLToPath(new URL('../scripts/source-census.mjs', import.meta.url));

test('source census retains every nonblank Markdown line as unreviewed evidence, not verification', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'pstack-census-'));
  try {
    await writeFile(join(directory, 'SKILL.md'), '# Contract\n\nMust preserve aliases.\nDo not infer approval.\n');
    await mkdir(join(directory, 'node_modules'));
    await writeFile(join(directory, 'node_modules', 'ignored.md'), 'Not authoritative.');
    const output = JSON.parse(execFileSync(process.execPath, [script, directory], { encoding: 'utf8' }));
    expect(output.files.map((file: { path: string }) => file.path)).toEqual([join(directory, 'SKILL.md')]);
    expect(output.files[0].lines).toEqual([
      { line: 1, text: '# Contract', state: 'UNREVIEWED' },
      { line: 3, text: 'Must preserve aliases.', state: 'UNREVIEWED' },
      { line: 4, text: 'Do not infer approval.', state: 'UNREVIEWED' },
    ]);
    expect(output.verdict).toBe('NOT VERIFIED');
    expect(execFileSync(process.execPath, [script, directory], { encoding: 'utf8' })).toBe(`${JSON.stringify(output, null, 2)}\n`);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('source census rejects missing inputs rather than reporting an empty verified inventory', () => {
  expect(() => execFileSync(process.execPath, [script], { stdio: 'pipe' })).toThrow();
});
