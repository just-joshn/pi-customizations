import { spawnSync } from 'node:child_process';
import { access, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, test } from 'vitest';
import { packageRoot } from './session-fixture.ts';

const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const available =
  process.platform === 'darwin' &&
  (await access(chrome).then(
    () => true,
    () => false,
  ));

test.skipIf(!available)(
  'real canvas browser saves accessibility and profiling evidence',
  async () => {
    const root = await mkdtemp(join(tmpdir(), 'pstack-canvas-evidence-'));
    try {
      const run = spawnSync(process.execPath, [join(packageRoot, 'scripts/verify-canvas-browser.mjs'), root], { encoding: 'utf8', timeout: 30000 });
      expect(run.status).toBe(0);
      const results = JSON.parse(await readFile(join(root, 'results.json'), 'utf8'));
      expect(results.checks).toContain('accessibility heading');
      expect(results.checks).toContain('sampled CPU profile');
      expect(results.checks).toContain('heap snapshot graph');
      const accessibility = JSON.parse(await readFile(join(root, 'accessibility.json'), 'utf8'));
      expect(accessibility.nodes.some((node: { role?: { value?: string }; name?: { value?: string } }) => node.role?.value === 'heading' && node.name?.value === 'Pi review canvas probe')).toBe(true);
      const cpu = JSON.parse(await readFile(join(root, 'canvas.cpuprofile'), 'utf8'));
      expect(cpu.samples.length).toBeGreaterThan(0);
      const heap = JSON.parse(await readFile(join(root, 'canvas.heapsnapshot'), 'utf8'));
      expect(heap.snapshot.meta.node_fields).toContain('self_size');
      expect(heap.nodes.length).toBeGreaterThan(0);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
  40000,
);
