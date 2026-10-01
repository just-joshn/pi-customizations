import { expect, test, vi } from 'vitest';
import { workerFixture } from './worker-fixture.ts';

async function exploreUnder(parentId: string) {
  const fixture = await workerFixture();
  try {
    const parent = fixture.session.extensionRunner.createContext().modelRegistry.getAvailable().find((model) => model.provider === 'worker-test' && model.id === parentId);
    if (!parent) throw new Error(`missing ${parentId}`);
    await fixture.session.setModel(parent);
    const done = (await fixture.call('Agent', { description: 'capped explore', prompt: 'hello', subagent_type: 'Explore', run_in_background: false })) as { details: Record<string, unknown> };
    return done.details.resolvedModel;
  } finally {
    await fixture.close();
  }
}

test('Explore under a parent above the Opus family runs on the newest Opus model of that provider', async () => {
  expect(await exploreUnder('claude-fable-1')).toBe('worker-test/claude-opus-5');
});

test('Explore inherits a parent outside the capped families', async () => {
  expect(await exploreUnder('deterministic')).toBe('worker-test/deterministic');
});

test('CLAUDE_CODE_DISABLE_EXPLORE_INHERIT_CAP lets Explore inherit the parent model', async () => {
  vi.stubEnv('CLAUDE_CODE_DISABLE_EXPLORE_INHERIT_CAP', '1');
  expect(await exploreUnder('claude-fable-1')).toBe('worker-test/claude-fable-1');
});
