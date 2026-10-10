import { mkdir, symlink, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';

import { Type } from 'typebox';
import { expect, test } from 'vitest';
import { absRootPath } from '../../src/core/chat-files.ts';
import { maintainerExtension } from '../support/maintainer.ts';
import { oracleCases, outcomeOf } from '../support/oracle.ts';
import { piSessionFixture } from '../support/pi-session.ts';

const schema = Type.Object({ path: Type.String(), existing: Type.Optional(Type.Boolean()) });
test.for(oracleCases('core', 'core.root_path', schema))('abs_root_path $id', async ({ args, expected }) => {
  const f = await piSessionFixture({ extension: maintainerExtension() });
  const child = join(f.root, 'outside', 'child');
  await mkdir(child, { recursive: true });
  await symlink(child, join(f.cwd, 'link'));
  if (args.existing) await writeFile(join(f.root, 'outside', 'target.txt'), 'before');
  expect(await outcomeOf(() => relative(f.root, absRootPath(f.cwd, args.path)))).toEqual(expected);
});
