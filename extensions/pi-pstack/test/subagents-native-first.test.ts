import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { expect, test } from 'vitest';
import { scan, undocumentedExceptions } from '../scripts/check-subagent-native-first.mjs';
import { scratchDir } from './support/scratch.ts';

test('the pi-subagents source is clean while the same gate catches a planted stand-in', () => {
  const root = scratchDir('pstack-native-first-');
  mkdirSync(join(root, 'src/subagents'), { recursive: true });
  writeFileSync(join(root, 'src/subagents/stand-in.ts'), 'setInterval(tick, 5);\n');
  expect(scan(root)).toHaveLength(1);
  expect(scan()).toEqual([]);
  expect(undocumentedExceptions()).toEqual([]);
});

test.for([
  { rule: 'settings-manager', source: 'SettingsManager.create(cwd, dir);' },
  { rule: 'poll-timer', source: 'setInterval(tick, 5);' },
  { rule: 'child-process', source: "import { spawn } from 'node:child_process';" },
  { rule: 'side-file', source: 'appendFileSync(file, line);' },
  { rule: 'output-schema', source: 'const tool = { outputSchema: Schema };' },
])('the gate names the $rule stand-in it finds in a source file', ({ rule, source }) => {
  const root = scratchDir('pstack-native-first-');
  mkdirSync(join(root, 'src/subagents'), { recursive: true });
  writeFileSync(join(root, 'src/subagents/stand-in.ts'), `${source}\n`);
  expect(scan(root)).toEqual([expect.objectContaining({ rule, path: 'src/subagents/stand-in.ts' })]);
});

test('the gate accepts an exception only in a file the rule allows', () => {
  const root = scratchDir('pstack-native-first-');
  mkdirSync(join(root, 'src/subagents'), { recursive: true });
  writeFileSync(join(root, 'src/subagents/tracked-bash.ts'), "import { spawn } from 'node:child_process';\n");
  writeFileSync(join(root, 'src/subagents/other.ts'), "import { spawn } from 'node:child_process';\n");
  expect(scan(root).map((problem) => problem.path)).toEqual(['src/subagents/other.ts']);
});
