import { expect, test } from 'vitest';
import { chooseFence } from '../src/edit/fences.ts';

test('selects a fence absent from the editable file content', { meta: { aider: ['test_coder/TestCoder.test_choose_fence'] } }, () => {
  expect(chooseFence(['this contains\n```\nbackticks'])).toEqual({ fence: ['````', '````'], warnings: [] });
});
