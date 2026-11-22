import { describe, expect, it } from 'vitest';
import { TaskToolInputSchema } from '../src/types.ts';

describe('task thinking level', () => {
  it('accepts every Pi thinking level', () => {
    for (const thinking of ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const) {
      expect(TaskToolInputSchema.parse({ description: 'x', thinking }).thinking).toBe(thinking);
    }
  });

  it('rejects an unknown level', () => {
    expect(TaskToolInputSchema.safeParse({ description: 'x', thinking: 'ultra' }).success).toBe(false);
  });
});
