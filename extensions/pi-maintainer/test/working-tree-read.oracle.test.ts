import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Type } from 'typebox';
import { expect, onTestFinished, test, vi } from 'vitest';
import { createWorkingTree } from '../src/edit/working-tree.ts';
import { oracleCases, outcomeOf } from './support/oracle.ts';

const schema = Type.Object({
  bytes: Type.Array(Type.Integer({ minimum: 0, maximum: 255 })),
  encoding: Type.Optional(Type.String()),
  kind: Type.Union([Type.Literal('file'), Type.Literal('missing'), Type.Literal('directory')]),
});

test.for(oracleCases('io-read', 'io.read', schema))('reads Aider text $id', async ({ args, expected }) => {
  const root = await mkdtemp(join(tmpdir(), 'pi-maintainer-read-'));
  onTestFinished(() => rm(root, { recursive: true, force: true }));
  const path = join(root, 'source.txt');
  if (args.kind === 'file') await writeFile(path, Buffer.from(args.bytes));
  if (args.kind === 'directory') await mkdir(path);
  const notices = { output: vi.fn(), warning: vi.fn(), error: vi.fn<(message: string) => void>() };
  const tree = createWorkingTree({ encoding: args.encoding ?? 'utf-8', notices });

  expect(
    await outcomeOf(async () => {
      const text = await tree.read(path);
      const errors = notices.error.mock.calls.map(([message]) => message.replace(path, 'source.txt'));
      return { text, errors };
    }),
  ).toEqual(expected);
});
