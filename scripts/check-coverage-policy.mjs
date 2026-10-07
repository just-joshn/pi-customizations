import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const packages = readdirSync(join(root, 'extensions'), { withFileTypes: true }).filter((entry) => entry.isDirectory() && entry.name.startsWith('pi-'));
const metrics = ['statements', 'branches', 'functions', 'lines'];
for (const entry of packages) {
  const { default: config } = await import(pathToFileURL(join(root, 'extensions', entry.name, 'vitest.config.ts')).href);
  const thresholds = config.test?.coverage?.thresholds;
  for (const metric of metrics) {
    assert.ok(typeof thresholds?.[metric] === 'number' && thresholds[metric] >= 80, `${entry.name} must enforce at least 80% ${metric} coverage`);
  }
}
console.log(`Coverage floor enforced for ${packages.length} packages across ${metrics.join(', ')}.`);
