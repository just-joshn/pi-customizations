import { expect, test } from 'vitest';

test('a non-loopback request is rejected before it leaves the machine', async () => {
  await expect(fetch('https://example.invalid/blocked')).rejects.toThrow('Blocked external network request to https://example.invalid/blocked');
});
