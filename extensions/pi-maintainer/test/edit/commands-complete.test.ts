import { expect, test } from 'vitest';
import type { CommandEnv } from '../../src/core/command.ts';
import { editCommands } from '../../src/edit/commands.ts';
import { disabledGitPolicy } from '../../src/feature.ts';

test('add argument completions list tracked files that are not already in chat', { meta: { aider: ['test_io/TestInputOutput.test_autocompleter_get_command_completions'] } }, async () => {
  const add = editCommands.find((command) => command.name === 'add');
  expect(add?.complete).toBeTypeOf('function');
  const env = {
    snapshot: {
      root: '/repo',
      files: { editable: ['/repo/inchat.py'], readOnly: [] as string[] },
    },
    git: {
      ...disabledGitPolicy,
      trackedFiles: async () => ['inchat.py', 'other.py', 'pkg/mod.py'],
    },
  } as unknown as CommandEnv;
  expect(await add!.complete!('o', env)).toEqual(['other.py']);
  expect(await add!.complete!('', env)).toEqual(['other.py', 'pkg/mod.py']);
});
