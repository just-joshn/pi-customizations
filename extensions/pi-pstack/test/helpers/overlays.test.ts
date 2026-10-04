import './leak-preload.ts';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { expect, test } from 'vitest';

const checker = fileURLToPath(new URL('../../scripts/resources.mjs', import.meta.url));

test('shipped helpers match the complete policy-formatted resource replay', () => {
  expect(execFileSync(process.execPath, [checker], { encoding: 'utf8' })).toBe('Verified 190 upstream files and 212 generated resources.\n');
});
