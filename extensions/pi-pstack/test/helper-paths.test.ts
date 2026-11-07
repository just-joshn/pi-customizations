import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';

import { getAgentDir } from '@earendil-works/pi-coding-agent';
import { expect, onTestFinished, test, vi } from 'vitest';
import { stateDir } from '../src/paths.ts';
import { defaultEnsureSupervisor } from '../src/subscriptions/ensure-supervisor.ts';

test.for([
  { name: 'default', value: undefined },
  { name: 'empty override', value: '' },
  { name: 'home itself', value: '~' },
  { name: 'home descendant', value: '~/custom agent' },
  { name: 'file URL', value: 'file:///tmp/agent%20directory' },
  { name: 'Unicode file URL', value: 'file:///tmp/%E2%9C%93' },
  { name: 'relative override', value: '../relative agent' },
  { name: 'untrimmed override', value: ' agent ' },
  { name: 'literal at sign', value: '@agent' },
])('the standalone state directory matches released Pi for $name', ({ value }) => {
  vi.stubEnv('PI_CODING_AGENT_DIR', value);
  onTestFinished(() => {
    vi.unstubAllEnvs();
  });
  expect(stateDir()).toBe(join(getAgentDir(), 'pstack'));
});

test.for(['relative', 'absolute', 'file-url'])('an extension-launched supervisor keeps its agent directory after a cwd change for %s', async (form, { signal }) => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'pstack-agent-boundary-')));
  onTestFinished(() => {
    vi.unstubAllEnvs();
    rmSync(dir, { recursive: true, force: true });
  });
  const nativeDir = join(dir, 'agent directory');
  const cwd = join(dir, 'B workspace');
  mkdirSync(cwd);
  const received = join(dir, 'received.json');
  const observer = join(dir, 'observe.mjs');
  writeFileSync(
    observer,
    `import fs from 'node:fs';\nimport { resolve } from 'node:path';\nfs.writeFileSync(${JSON.stringify(received)}, JSON.stringify({ pid: process.pid, cwd: process.cwd(), effectiveAgent: resolve(process.env.PI_CODING_AGENT_DIR) }));\n`,
  );
  const bin = join(dir, 'observe-environment');
  const pidFile = join(dir, 'observer.pid');
  writeFileSync(bin, `#!/bin/sh\nprintf '%s' "$$" > '${pidFile}'\ncd '${cwd}' || exit 1\nexec '${process.execPath}' '${observer}'\n`, { mode: 0o755 });
  onTestFinished(async () => {
    const pid = await vi.waitUntil(() => (existsSync(pidFile) ? Number(readFileSync(pidFile, 'utf8')) : undefined));
    try {
      process.kill(pid, 'SIGTERM');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
    }
    await expect
      .poll(() => {
        try {
          process.kill(pid, 0);
          return false;
        } catch {
          return true;
        }
      })
      .toBe(true);
  });
  vi.stubEnv('PI_CODING_AGENT_DIR', form === 'relative' ? relative(process.cwd(), nativeDir) : form === 'file-url' ? pathToFileURL(nativeDir).href : nativeDir);
  defaultEnsureSupervisor(cwd, { binPath: bin });
  await expect.poll(() => existsSync(received)).toBe(true);
  const child = JSON.parse(await readFile(received, { encoding: 'utf8', signal })) as { pid: number; cwd: string; effectiveAgent: string };
  const receipts = process.env['PSTACK_HELPER_RECEIPTS'];
  if (receipts !== undefined) {
    mkdirSync(receipts, { recursive: true });
    appendFileSync(join(receipts, 'ensure-boundaries.jsonl'), `${JSON.stringify({ form, origin: process.cwd(), expectedAgent: nativeDir, child })}\n`);
  }
  expect(child).toMatchObject({ cwd, effectiveAgent: nativeDir });
  await expect
    .poll(() => {
      try {
        process.kill(child.pid, 0);
        return false;
      } catch {
        return true;
      }
    })
    .toBe(true);
});

test('an extension-launched supervisor receives the native normalized agent directory', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'pstack-native-agent-dir-'));
  onTestFinished(() => {
    vi.unstubAllEnvs();
    rmSync(dir, { recursive: true, force: true });
  });
  const nativeDir = join(dir, 'agent directory');
  const cwd = join(dir, 'workspace');
  mkdirSync(cwd);
  const received = join(dir, 'received');
  const bin = join(dir, 'observe-environment');
  writeFileSync(bin, `#!/bin/sh\nprintf '%s' "$PI_CODING_AGENT_DIR" > '${received}'\n`, { mode: 0o755 });
  vi.stubEnv('PI_CODING_AGENT_DIR', pathToFileURL(nativeDir).href);
  defaultEnsureSupervisor(cwd, { binPath: bin });
  await expect.poll(() => existsSync(received)).toBe(true);
  expect(readFileSync(received, 'utf8')).toBe(getAgentDir());
  expect(readFileSync(received, 'utf8')).toBe(nativeDir);
});
