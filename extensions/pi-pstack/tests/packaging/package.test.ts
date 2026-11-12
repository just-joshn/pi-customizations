import { execFile } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';

import { expect, onTestFinished, test } from 'vitest';
import { generatedSkillNames } from '../../src/skill-routing.ts';

const PKG = resolve(import.meta.dirname, '../..');
const REMOVED_ROOTS = ['skills/', 'test/', 'bin/', 'agents/', 'rules/', 'packaging/', 'src/index.ts', 'src/task/', 'src/subscriptions/', 'src/cloud/', 'dist/supervisor-main.js', 'dist/release-machine.js'];

test('npm pack ships the native runtime and its sources without node_modules or the removed runtime', async ({ signal }) => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'pstack-pack-files-')));
  onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  const copy = join(root, 'pi-pstack');
  cpSync(PKG, copy, { recursive: true, filter: (source) => !/\/(node_modules|coverage)(\/|$)/.test(source.slice(PKG.length)) });
  const localOnly = join(copy, 'generated/skills/statechart/scripts/node_modules/local-only');
  mkdirSync(localOnly, { recursive: true });
  writeFileSync(join(localOnly, 'index.js'), 'throw new Error("must not ship");');

  const { stdout } = await promisify(execFile)('npm', ['pack', copy, '--dry-run', '--json', '--ignore-scripts'], { cwd: root, env: { ...process.env, npm_config_cache: join(root, 'npm-cache'), npm_config_update_notifier: 'false' }, signal });
  const packed = JSON.parse(stdout.slice(stdout.indexOf('[\n'))) as { files: { path: string }[] }[];
  const paths = packed.flatMap((entry) => entry.files.map((file) => file.path));

  expect(paths.filter((path) => path.includes('node_modules/'))).toEqual([]);
  expect(paths.filter((path) => REMOVED_ROOTS.some((removed) => path.startsWith(removed)))).toEqual([]);
  expect(paths).toEqual(
    expect.arrayContaining([
      'src/extension.ts',
      'src/worker-host.ts',
      'src/readonly-shell.ts',
      'scripts/start-run.mjs',
      'generated/upstream-lock.json',
      'generated/agents/poteto.md',
      'generated/prompts/poteto-mode.md',
      'generated/skills/statechart/scripts/statechart',
      'generated/skills/statechart/scripts/statechart.ts',
      'generated/skills/poteto-mode/scripts/watch-pr/watch-pr',
      'generated/skills/poteto-mode/scripts/watch-pr/cli.ts',
      'vendor/upstream-pstack/skills/poteto-mode/SKILL.md',
      'dist/helpers.json',
      'dist/watch-pr.js',
      'dist/worker-host.js',
      'dist/netbroker-s390x',
    ]),
  );
  expect(paths.filter((path) => path.startsWith('generated/skills/') && path.endsWith('/SKILL.md'))).toHaveLength(generatedSkillNames().length);
});
