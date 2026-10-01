import { expect, test } from 'vitest';
import { AdmissionSlots } from '../src/subagents/admission-slots.ts';

test('startup leases count independently and release only their own slot', () => {
  const slots = new AdmissionSlots();
  expect(slots.pending).toBe(0);
  const first = slots.reserve();
  const second = slots.reserve();
  expect(slots.pending).toBe(2);
  first();
  expect(slots.pending).toBe(1);
  first();
  expect(slots.pending).toBe(1);
  second();
  expect(slots.pending).toBe(0);
});
