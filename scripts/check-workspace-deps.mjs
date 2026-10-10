#!/usr/bin/env node
import { createRequire } from 'node:module';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));

export function missingWorkspaceDeps(repoRoot = root) {
  const extensionsRoot = join(repoRoot, 'extensions');
  if (!existsSync(extensionsRoot)) return [];
  const missing = [];
  for (const name of readdirSync(extensionsRoot)) {
    const packageJsonPath = join(extensionsRoot, name, 'package.json');
    if (!existsSync(packageJsonPath)) continue;
    const manifest = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
    const dependencies = Object.keys(manifest.dependencies ?? {});
    if (dependencies.length === 0) continue;
    const packageDir = join(extensionsRoot, name);
    const require = createRequire(join(packageDir, 'package.json'));
    for (const dependency of dependencies) {
      try {
        require.resolve(dependency);
      } catch {
        missing.push({ package: manifest.name ?? name, dependency, dir: `extensions/${name}` });
      }
    }
  }
  return missing;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const missing = missingWorkspaceDeps();
  if (missing.length === 0) {
    process.stdout.write('workspace runtime dependencies resolve\n');
  } else {
    for (const entry of missing) {
      process.stderr.write(
        `FAIL ${entry.package}: cannot resolve runtime dependency ${entry.dependency} from ${entry.dir}\n`,
      );
    }
    process.stderr.write('Hint: run `bun install` from the repository root, then retry.\n');
    process.exit(1);
  }
}
