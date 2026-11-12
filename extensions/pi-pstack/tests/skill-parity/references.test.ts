import { readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

import { expect, test } from 'vitest';
import { extractReferences } from '../../adapters/dependencies.ts';
import { listFiles } from '../../adapters/provenance.ts';
import { PKG } from './helpers.ts';

test('every relative reference in generated skills resolves inside the generated package', () => {
  const skillsRoot = join(PKG, 'generated/skills');
  const unresolved: string[] = [];
  let checked = 0;
  for (const file of listFiles(skillsRoot).filter((f) => f.endsWith('.md'))) {
    const abs = join(skillsRoot, file);
    for (const ref of extractReferences(readFileSync(abs, 'utf8'), file, abs, join(skillsRoot, file.split('/')[0] ?? ''))) {
      checked++;
      if (!ref.resolved || relative(join(PKG, 'generated'), ref.resolved).startsWith('..')) unresolved.push(`${file}:${ref.line} ${ref.target}`);
    }
  }
  expect(checked).toBeGreaterThan(100);
  expect(unresolved).toEqual([]);
});
