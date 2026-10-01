import { spawn } from 'node:child_process';
import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, test, vi } from 'vitest';
import { packageRoot } from './session-fixture.ts';

test.each(['SIGINT', 'SIGTERM'] as const)(
  'interrupting the owned history profiler with %s removes its corpus',
  async (signal) => {
    const root = await mkdtemp(join(tmpdir(), 'pstack-profile-signal-'));
    const hook = join(root, 'capture.mjs');
    await writeFile(
      hook,
      `import fs from 'node:fs/promises';\nimport { mock } from 'node:test';\nimport { syncBuiltinESMExports } from 'node:module';\nconst original = fs.mkdtemp;\nmock.method(fs, 'mkdtemp', async (...args) => { const directory = await original(...args); if (String(args[0]).includes('pstack-profile-history-')) process.stdout.write(JSON.stringify({ directory }) + '\\n'); return directory; });\nsyncBuiltinESMExports();\n`,
    );
    const child = spawn(process.execPath, ['--import', hook, join(packageRoot, 'scripts/profile-history.mjs'), join(root, 'evidence'), '5000'], { stdio: ['ignore', 'pipe', 'pipe'] });
    const exited = new Promise((resolve, reject) => {
      child.once('exit', resolve);
      child.once('error', reject);
    });
    let output = '';
    let corpus: string | undefined;
    child.stdout.on('data', (chunk) => {
      output += String(chunk);
    });
    try {
      await vi.waitFor(
        () => {
          expect(output.includes('\n')).toBe(true);
        },
        { timeout: 10000 },
      );
      corpus = JSON.parse(output.split('\n')[0]).directory;
      if (!corpus) throw new Error('missing owned corpus');
      expect((await stat(corpus)).isDirectory()).toBe(true);
      expect(child.kill(signal)).toBe(true);
      await exited;
      await expect(stat(corpus)).rejects.toMatchObject({ code: 'ENOENT' });
    } finally {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill('SIGTERM');
        await exited;
      }
      if (corpus) await rm(corpus, { recursive: true, force: true });
      await rm(root, { recursive: true, force: true });
    }
  },
  30000,
);
