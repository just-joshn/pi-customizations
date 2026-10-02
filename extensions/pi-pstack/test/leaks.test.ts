import { expect, test } from 'vitest';
import {
  formatLeakReport,
  groupLeaks,
  isToolCache,
  leakPrefix,
  parseDu,
  parseLiveProcesses,
  parseLsofCwd,
} from './support/leaks.ts';

const DIR = '/private/var/T/pv-AbC123';

test.for([
  { name: 'pstack-workers-aB3dE9', prefix: 'pstack-workers' },
  { name: 'com.google.Chrome.XyZ123', prefix: 'com.google.Chrome' },
  { name: 'pstack-integration-123456', prefix: 'pstack-integration' },
  { name: 'scratch', prefix: 'scratch' },
])('leakPrefix strips the mkdtemp suffix from $name', ({ name, prefix }) => {
  expect(leakPrefix(name)).toBe(prefix);
});

test('groupLeaks counts and sums sizes per prefix, largest first', () => {
  const groups = groupLeaks([
    { name: 'a-aaaaaa', kb: 4 },
    { name: 'b-bbbbbb', kb: 40 },
    { name: 'a-cccccc', kb: 8 },
  ]);
  expect(groups).toStrictEqual([
    { prefix: 'b', count: 1, kb: 40 },
    { prefix: 'a', count: 2, kb: 12 },
  ]);
});

test('parseDu skips the directory total and returns children relative to the run directory', () => {
  const output = `4\t${DIR}/x-aaaaaa\n12\t${DIR}/y.log\n20\t${DIR}\n`;
  expect(parseDu(output, DIR)).toStrictEqual([
    { name: 'x-aaaaaa', kb: 4 },
    { name: 'y.log', kb: 12 },
  ]);
});

test('parseLiveProcesses keeps only processes that mention the run directory and are not ignored', () => {
  const output = [
    `  101 node server.js TMPDIR=${DIR} HOME=/h`,
    '  102 node unrelated.js HOME=/h',
    `  103 ps -axwwE TMPDIR=${DIR}`,
  ].join('\n');
  expect(parseLiveProcesses(output, DIR, new Set([103]))).toStrictEqual([
    { pid: 101, command: `node server.js TMPDIR=${DIR} HOME=/h` },
  ]);
});

test('parseLsofCwd reports processes whose working directory is under the run directory', () => {
  const output = `p201\nn${DIR}/work\np202\nn/elsewhere\np203\nn${DIR}\n`;
  expect(parseLsofCwd(output, DIR, new Set([203]))).toStrictEqual([
    { pid: 201, command: `cwd ${DIR}/work` },
  ]);
});

test('formatLeakReport prints groups and live processes, or an empty marker', () => {
  expect(formatLeakReport(DIR, [], [])).toBe(
    `[leak-report] run directory ${DIR}\n[leak-report] no leftover entries\n`,
  );
  expect(
    formatLeakReport(DIR, [{ prefix: 'a', count: 2, kb: 12 }], [{ pid: 9, command: 'node x' }]),
  ).toBe(
    `[leak-report] run directory ${DIR}\n[leak-report]     2 x a 12 KB\n[leak-report] LIVE pid 9: node x\n`,
  );
});

test('isToolCache recognises the node and jiti caches only', () => {
  expect(isToolCache('node-compile-cache')).toBe(true);
  expect(isToolCache('jiti')).toBe(true);
  expect(isToolCache('pstack-workers-aB3dE9')).toBe(false);
});

test('formatLeakReport lists tool caches apart from leaks', () => {
  expect(formatLeakReport(DIR, [], [], [{ prefix: 'jiti', count: 1, kb: 3064 }])).toBe(
    `[leak-report] run directory ${DIR}\n[leak-report] tool cache jiti 3064 KB\n[leak-report] no leftover entries\n`,
  );
});
