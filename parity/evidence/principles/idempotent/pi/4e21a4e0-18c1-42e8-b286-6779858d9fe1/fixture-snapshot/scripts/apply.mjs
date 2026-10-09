#!/usr/bin/env node
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const crashRaw = process.env.CRASH_AFTER;
const crashAfter = crashRaw === undefined || crashRaw === '' ? null : Number(crashRaw);

const { apply } = await import(`${pathToFileURL(join(root, 'src', 'apply.js')).href}?t=${Date.now()}`);

try {
  const result = await apply(root, { crashAfter: Number.isFinite(crashAfter) ? crashAfter : null });
  console.log(`APPLY-DONE ${JSON.stringify(result)}`);
  process.exit(0);
} catch (e) {
  const code = e && typeof e === 'object' && 'code' in e ? e.code : null;
  if (code === 'CRASH_AFTER_STEP_1') {
    console.error('CRASH_AFTER_STEP_1');
    process.exit(2);
  }
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
}
