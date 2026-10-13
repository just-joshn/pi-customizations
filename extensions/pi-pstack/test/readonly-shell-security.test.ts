import { existsSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

import type { ExtensionAPI, ExtensionToolContext, ToolDefinition } from '@earendil-works/pi-coding-agent';
import { afterEach, expect, test, vi } from 'vitest';

// The real sandbox is the subject here (macOS/Linux only); these tests prove the enforcement the tool promises.
const supported = process.platform === 'darwin' || process.platform === 'linux';
// An in-process consumer of the same dependency may have initialized a permissive policy first; the shell must not
// inherit it (reviews/resume-security.md finding 3).
vi.mock(import('@anthropic-ai/sandbox-runtime'), async (importOriginal) => {
  const original = await importOriginal();
  if (supported)
    await original.SandboxManager.initialize({
      network: { allowedDomains: ['example.com'], deniedDomains: [] },
      filesystem: { denyRead: [], allowWrite: [tmpdir()], denyWrite: [] },
    });
  return original;
});

const { registerReadonlyShell } = await import('../src/readonly-shell.ts');

let dir: string;
afterEach(() => {
  if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
});

function bash(): ToolDefinition {
  const tools: ToolDefinition[] = [];
  registerReadonlyShell({ registerTool: (tool: ToolDefinition) => tools.push(tool), on: () => undefined } as unknown as ExtensionAPI);
  const [tool] = tools;
  if (tool === undefined) throw new Error('no tool registered');
  return tool;
}

const run = async (tool: ToolDefinition, command: string, signal?: AbortSignal): Promise<string> => {
  const result = await tool.execute('call', { command }, signal, undefined, { cwd: dir } as ExtensionToolContext);
  return result.content.map((part) => (part.type === 'text' ? part.text : '')).join('\n');
};

test.skipIf(!supported)('a shared pre-initialized sandbox policy does not weaken the shell (TASK-019)', async () => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), 'pi-pstack-ro-shared-')));
  const text = await run(bash(), `printf shared-escape > ${join(dir, 'shared-escape.txt')} && cat ${join(dir, 'shared-escape.txt')}`).catch((error: Error) => `ERROR: ${error.message}`);
  expect(text).toContain('Operation not permitted');
  expect(existsSync(join(dir, 'shared-escape.txt'))).toBe(false);
});

test.skipIf(!supported)('the dependency default write paths stay denied (TASK-019)', async () => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), 'pi-pstack-ro-paths-')));
  const tmpClaude = process.platform === 'darwin' ? '/private/tmp/claude' : '/tmp/claude';
  const home = homedir();
  const homeEscape = join(home, '.claude/debug/pstack-escape.txt');
  rmSync(homeEscape, { force: true });
  const script = `mkdir -p ${tmpClaude} ~/.claude/debug 2>/dev/null; (printf x > ${tmpClaude}/pstack-escape && echo TMP-CLAUDE-WROTE); (printf x > ${homeEscape} && echo HOME-DEBUG-WROTE); echo done`;
  const text = await run(bash(), script);
  expect(text).not.toContain('TMP-CLAUDE-WROTE');
  expect(text).not.toContain('HOME-DEBUG-WROTE');
  expect(text).toContain('done');
  expect(existsSync(homeEscape)).toBe(false);
  rmSync(join(tmpClaude, 'pstack-escape'), { force: true });
});

test.skipIf(!supported)('an inherited BASH_ENV startup file never runs outside the sandbox (TASK-019)', async () => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), 'pi-pstack-ro-env-')));
  const marker = join(dir, 'bashenv-escape.txt');
  const startup = join(dir, 'startup.sh');
  writeFileSync(startup, `printf escaped > ${marker}\n`);
  process.env['BASH_ENV'] = startup;
  try {
    const text = await run(bash(), 'echo sandbox-ran');
    expect(text).toContain('sandbox-ran');
  } finally {
    delete process.env['BASH_ENV'];
  }
  expect(existsSync(marker)).toBe(false);
});

test.skipIf(!supported)('an already-aborted call never spawns the command (TASK-019)', async () => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), 'pi-pstack-ro-abort-')));
  const controller = new AbortController();
  controller.abort();
  await expect(run(bash(), 'sleep 1; printf ran-after-abort', controller.signal)).rejects.toThrow(/aborted/i);
});
