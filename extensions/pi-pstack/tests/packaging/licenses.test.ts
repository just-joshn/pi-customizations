import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, test } from 'vitest';

const root = fileURLToPath(new URL('../..', import.meta.url));
const bundled: [name: string, notice: string][] = [['yaml', 'licenses/yaml.LICENSE'], ['typebox', 'licenses/typebox.LICENSE']];

test.each(bundled)('%s is inlined into a dist bundle, so its license ships and the README lists it', (name, notice) => {
  const bundle = readFileSync(join(root, 'dist/automation-serve.js'), 'utf8');
  expect(bundle).toContain(`node_modules/${name}/`);
  const installed = readFileSync(join(root, 'node_modules', name, 'LICENSE'), 'utf8');
  expect(readFileSync(join(root, notice), 'utf8')).toContain(installed.trim());
  expect(readFileSync(join(root, 'README.md'), 'utf8')).toContain(notice);
  const pack = spawnSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], { cwd: root, encoding: 'utf8' });
  expect(pack.status, pack.stderr).toBe(0);
  const files = (JSON.parse(pack.stdout.slice(pack.stdout.indexOf('[\n'))) as { files: { path: string }[] }[]).flatMap((a) => a.files.map((f) => f.path));
  expect(files).toContain(notice);
});
