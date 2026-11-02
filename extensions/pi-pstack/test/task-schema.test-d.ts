import type { Static } from 'typebox';
import { expectTypeOf, test } from 'vitest';
import type { TaskParams } from '../src/task/tool.ts';

test('Task environment is an optional literal enum', () => {
  expectTypeOf<Static<typeof TaskParams>['environment']>().toEqualTypeOf<'local' | 'cloud' | undefined>();
  expectTypeOf<{ description: string; prompt: string }>().toExtend<Static<typeof TaskParams>>();
});
