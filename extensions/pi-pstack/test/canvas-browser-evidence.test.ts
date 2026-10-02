import { spawn } from 'node:child_process';
import { access, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, onTestFinished, test } from 'vitest';
import { packageRoot } from './session-fixture.ts';

const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const available =
  process.platform === 'darwin' &&
  (await access(chrome).then(
    () => true,
    () => false,
  ));

function runHarness(root: string): Promise<{ status: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [join(packageRoot, 'scripts/verify-canvas-browser.mjs'), root], { stdio: ['ignore', 'pipe', 'pipe'] });
    onTestFinished(() => {
      child.kill('SIGTERM');
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
    });
    child.once('error', reject);
    child.once('close', (status) => resolve({ status, stdout, stderr }));
  });
}

test.skipIf(!available)(
  'real canvas browser saves accessibility and profiling evidence',
  async () => {
    const root = await mkdtemp(join(tmpdir(), 'pstack-canvas-evidence-'));
    try {
      const run = await runHarness(root);
      expect(run.status, `stdout ${run.stdout} stderr ${run.stderr}`).toBe(0);
      const results = JSON.parse(await readFile(join(root, 'results.json'), 'utf8'));
      expect(results.checks).toContain('accessibility heading');
      expect(results.checks).toContain('sampled CPU profile');
      expect(results.checks).toContain('heap snapshot graph');
      expect(results.checks).toContain('network fixture bytes');
      expect(results.checks).toContain('pointer click trace');
      expect(await readFile(join(root, 'canvas-response.html'), 'utf8')).toBe(await readFile(join(root, 'canvas.html'), 'utf8'));
      const trace = JSON.parse(await readFile(join(root, 'canvas.trace.json'), 'utf8'));
      expect(trace.traceEvents.some((event: { name?: string; args?: { data?: { type?: string } } }) => event.name === 'EventDispatch' && event.args?.data?.type === 'click')).toBe(true);
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
  120000,
);
