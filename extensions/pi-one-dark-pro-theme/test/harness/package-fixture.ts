import { cpSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { test as base } from 'vitest';
import { THEME_NAME } from '../../parity/theme.ts';

export interface PackageFixture {
  readonly root: string;
  readonly themePath: string;
  readonly upstreamPath: string;
  readonly roleMapPath: string;
}

export const test = base.extend<{
  sourceRoot: string;
  packageFixture: PackageFixture;
}>({
  sourceRoot: join(dirname(fileURLToPath(import.meta.url)), '..', '..'),

  packageFixture: async ({ sourceRoot }, use) => {
    const root = mkdtempSync(join(tmpdir(), 'pi-one-dark-pro-theme-'));
    const fixture: PackageFixture = {
      root,
      themePath: join(root, 'artifacts', `${THEME_NAME}.json`),
      upstreamPath: join(root, 'upstream', 'OneDark-Pro-flat.json'),
      roleMapPath: join(root, 'parity', 'role-map.tsv'),
    };
    mkdirSync(dirname(fixture.themePath), { recursive: true });
    mkdirSync(dirname(fixture.upstreamPath), { recursive: true });
    mkdirSync(dirname(fixture.roleMapPath), { recursive: true });
    cpSync(join(sourceRoot, 'themes', `${THEME_NAME}.json`), fixture.themePath);
    cpSync(join(sourceRoot, 'upstream', 'OneDark-Pro-flat.json'), fixture.upstreamPath);
    cpSync(join(sourceRoot, 'parity', 'role-map.tsv'), fixture.roleMapPath);
    try {
      await use(fixture);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  },
});
