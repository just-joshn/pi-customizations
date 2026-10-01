import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { SessionManager } from '@earendil-works/pi-coding-agent';
import { expect, test } from 'vitest';
import { workspaceHistory } from '../src/history.ts';

test('workspace file URLs retain SDK discovery without admitting foreign ownership', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pstack-history-path-'));
  const cwd = join(root, 'work space # percent %');
  try {
    await mkdir(cwd);
    const path = join(root, 'own.jsonl');
    await writeFile(path, `${JSON.stringify({ type: 'session', id: 'own', cwd: pathToFileURL(cwd).href })}\n`);
    await writeFile(join(root, 'foreign.jsonl'), `${JSON.stringify({ type: 'session', id: 'foreign', cwd: pathToFileURL(join(root, 'other')).href })}\n`);
    expect((await SessionManager.list(cwd, root)).map(({ id }) => id)).toEqual(['own']);
    expect(await workspaceHistory(cwd, root)).toEqual([{ id: 'own', path, name: undefined }]);
    expect(await workspaceHistory(pathToFileURL(cwd).href, root)).toEqual([{ id: 'own', path, name: undefined }]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('bare home ownership uses the SDK path convention', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pstack-history-home-'));
  try {
    const path = join(root, 'own.jsonl');
    await writeFile(path, '{"type":"session","id":"own","cwd":"~"}\n');
    expect((await SessionManager.list(homedir(), root)).map(({ id }) => id)).toEqual(['own']);
    expect(await workspaceHistory(homedir(), root)).toEqual([{ id: 'own', path, name: undefined }]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
