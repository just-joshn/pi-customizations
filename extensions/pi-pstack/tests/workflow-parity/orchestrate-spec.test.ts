import { expect, test } from 'vitest';
import { orchestrateFamily } from './families/pr-orchestrate.ts';
import type { Ctx } from './lib/driver.ts';

test('the real orchestrate request scopes two new modules instead of referring to nonexistent PRs', () => {
  const prompt = orchestrateFamily.spec.prompt({} as Ctx);
  expect(prompt).toContain('Build');
  expect(prompt).toContain('greet(\'ada\') === \'hello ada\'');
  expect(prompt).toContain('shout(\'ada\') === \'HELLO ADA\'');
  expect(prompt).toContain('reserved');
  expect(prompt).toContain('src/greet.js');
  expect(prompt).toContain('src/shout.js');
});
