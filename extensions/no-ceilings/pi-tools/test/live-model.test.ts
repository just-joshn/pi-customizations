import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * Live-provider compatibility, opt in with PI_TOOLS_LIVE=1. Unlike the other suites, this uses the
 * developer's configured profile and a real model, so it costs money and the model may vary. It only
 * checks that the extension loads and a real provider can call a layer tool.
 */

const live = process.env['PI_TOOLS_LIVE'] === '1';
const extensionPath = path.join(import.meta.dirname, '..', 'src', 'index.ts');
const model = process.env['PI_TOOLS_LIVE_MODEL'] ?? 'deepseek-flash';

describe.skipIf(!live)('live: real provider can call the layer', () => {
  it(`writes a file through a real model (${model})`, async ({ signal }) => {
    const workspace = await mkdtemp(path.join(tmpdir(), 'pi-tools-live-'));
    try {
      const env: NodeJS.ProcessEnv = { ...process.env };
      delete env['NODE_V8_COVERAGE'];
      const child = spawn('pi', ['--print', '--model', model, '--tools', 'write,read', '-e', extensionPath, 'Use the write tool to create live.txt with exactly the content live, then reply LIVE-OK.'], {
        cwd: workspace,
        stdio: ['ignore', 'pipe', 'pipe'],
        signal,
        env,
      });
      let stdout = '';
      child.stdout.on('data', (chunk: Buffer) => {
        stdout += chunk.toString();
      });
      const code = await new Promise<number | null>((resolve, reject) => {
        child.once('error', reject);
        child.once('close', resolve);
      });
      expect(code).toBe(0);
      expect(stdout).toContain('LIVE-OK');
      expect(await readFile(path.join(workspace, 'live.txt'), 'utf-8')).toContain('live');
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  }, 150_000);
});
