import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, onTestFinished, test } from 'vitest';
import { markdownAgentFiles, maxAgentFileBytes } from '../src/subagents/agent-sources.ts';

async function agentDir() {
  const root = await mkdtemp(join(tmpdir(), 'agent-sources-'));
  onTestFinished(() => rm(root, { recursive: true, force: true }));
  return root;
}

// biome-ignore lint/security/noSecrets: the test title trips the entropy heuristic; there is no secret here.
test('markdownAgentFiles tells a populated directory from a missing one', async () => {
  const root = await agentDir();
  await writeFile(join(root, 'a.md'), 'a');
  expect(markdownAgentFiles(root, [])).toEqual([join(root, 'a.md')]);
  const logs: string[] = [];
  expect(markdownAgentFiles(join(root, 'absent'), logs)).toStrictEqual([]);
  expect(logs).toStrictEqual([]);
});

// biome-ignore lint/security/noSecrets: the test title trips the entropy heuristic; there is no secret here.
test('markdownAgentFiles treats a file path as an empty directory', async () => {
  const root = await agentDir();
  const file = join(root, 'plain.md');
  await writeFile(file, 'not a directory');
  expect(markdownAgentFiles(root, [])).toEqual([file]);
  expect(markdownAgentFiles(file, [])).toStrictEqual([]);
});

// biome-ignore lint/security/noSecrets: the test title trips the entropy heuristic; there is no secret here.
test('markdownAgentFiles collects nested markdown files in sorted order', async () => {
  const root = await agentDir();
  await mkdir(join(root, 'nested', 'deeper'), { recursive: true });
  await writeFile(join(root, 'b.md'), 'b');
  await writeFile(join(root, 'a.md'), 'a');
  await writeFile(join(root, 'nested', 'c.md'), 'c');
  await writeFile(join(root, 'nested', 'deeper', 'd.md'), 'd');
  await writeFile(join(root, 'skip-me.txt'), 'not markdown');
  expect(markdownAgentFiles(root, [])).toEqual([join(root, 'a.md'), join(root, 'b.md'), join(root, 'nested', 'c.md'), join(root, 'nested', 'deeper', 'd.md')]);
});

// biome-ignore lint/security/noSecrets: the test title trips the entropy heuristic; there is no secret here.
test('markdownAgentFiles skips oversized files with a logged reason', async () => {
  const root = await agentDir();
  const oversized = join(root, 'too-big.md');
  await writeFile(oversized, 'x'.repeat(maxAgentFileBytes + 1));
  await writeFile(join(root, 'fits.md'), 'fits');
  const logs: string[] = [];
  expect(markdownAgentFiles(root, logs)).toEqual([join(root, 'fits.md')]);
  expect(logs).toEqual([`loadMarkdownFilesFromDir: skipping ${oversized}: not a regular file or exceeds ${maxAgentFileBytes} byte limit`]);
});
