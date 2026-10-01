import { expect, test, vi } from 'vitest';
import type { ExtensionContext } from '@earendil-works/pi-coding-agent';
import { openCloudWorker } from '../src/cloud-worker.ts';
import { resolveRemotePlacement } from '../src/remote-worker.ts';

vi.mock(import('../src/remote-worker.ts'), async (original) => ({
  ...(await original()),
  resolveRemotePlacement: vi.fn(),
}));

test('cloud Tasks reject missing VM placement before creating any local worktree', async () => {
  vi.mocked(resolveRemotePlacement).mockRejectedValue(new Error('No isolated executor configured'));
  const ctx = { cwd: '/workspace', sessionManager: { getSessionFile: () => undefined } } as unknown as ExtensionContext;
  await expect(openCloudWorker({ id: 'fixture', params: { prompt: 'work', environment: 'cloud' }, prior: undefined, ctx })).rejects.toThrow('No isolated executor configured');
  expect(resolveRemotePlacement).toHaveBeenCalledWith('/workspace', { prompt: 'work', environment: 'cloud' }, undefined);
});
