import { resolve } from 'node:path';

import { Type } from 'typebox';
import { expect, test } from 'vitest';
import { applyEdits, getEdits } from '../src/edit/wholefile.ts';
import { oracleCases, outcomeOf } from './support/oracle.ts';

const fence = Type.Tuple([Type.String(), Type.String()]);
const parseArgs = Type.Object({
  content: Type.String(),
  chat_files: Type.Optional(Type.Array(Type.String())),
  fence: Type.Optional(fence),
});
const source = Type.Union([Type.Literal('block'), Type.Literal('saw'), Type.Literal('chat')]);
const applyArgs = Type.Object({ edits: Type.Array(Type.Tuple([Type.String(), source, Type.Array(Type.String())])) });

test.for(oracleCases('wholefile', 'wholefile.get_edits', parseArgs))('getEdits $id', async ({ args, expected }) => {
  expect(await outcomeOf(() => getEdits(args.content, args.chat_files, args.fence))).toEqual(expected);
});

test.for(oracleCases('wholefile', 'wholefile.apply_edits', applyArgs))('applyEdits $id', async ({ args, expected }) => {
  const writes: [string, string][] = [];
  const result = await outcomeOf(async () => {
    await applyEdits(args.edits, {
      absRootPath: (path) => resolve('/project', path),
      tree: {
        write: async (path, content) => {
          writes.push([path, content]);
        },
      },
    });
    return writes;
  });
  expect(result).toEqual(expected);
});
