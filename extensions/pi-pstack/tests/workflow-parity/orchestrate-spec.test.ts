import { expect, test } from 'vitest';
import { autopilotFullFamily } from './families/pr-autopilot.ts';
import { orchestrateFamily } from './families/pr-orchestrate.ts';
import type { Ctx } from './lib/driver.ts';

test('the autopilot request specifies new work and reserved PR numbers', () => {
  const prompt = autopilotFullFamily.spec.prompt({} as Ctx);
  expect(prompt).toContain('reserved, not existing');
  expect(prompt).toContain("greet('ada') === 'hello ada'");
  expect(prompt).toContain("shout('ada') === 'HELLO ADA'");
  expect(prompt).toContain('feat-greet');
  expect(prompt).toContain('feat-shout');
  expect(prompt).toContain('test/');
});

test('the real orchestrate request scopes two new modules instead of referring to nonexistent PRs', () => {
  const prompt = orchestrateFamily.spec.prompt({} as Ctx);
  expect(prompt).toContain('Build');
  expect(prompt).toContain("greet('ada') === 'hello ada'");
  expect(prompt).toContain("shout('ada') === 'HELLO ADA'");
  expect(prompt).toContain('reserved');
  expect(prompt).toContain('src/greet.js');
  expect(prompt).toContain('src/shout.js');
});
