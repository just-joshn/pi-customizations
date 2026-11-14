import { expect, test } from 'vitest';

import { autopilotFamilies } from './families/pr-autopilot.ts';
import { orchestrateSubFamily } from './families/pr-orchestrate-sub.ts';
import type { Ctx } from './lib/driver.ts';

const prompt = (id: string) => [...autopilotFamilies, orchestrateSubFamily].find((family) => family.id === id)!.spec.prompt({} as Ctx);

test('lane task names the reserved PR, branch and observable lookup contract', () => {
  const text = prompt('autopilot-lanes');
  for (const word of ['reserved', 'feat-table', 'src/table.js', '3000', 'lookup', 'budget.json']) expect(text).toContain(word);
});
test('nested orchestration tasks specify new reserved PRs and independent string behaviors', () => {
  const text = prompt('orchestrate-sub');
  for (const word of ['reserved', 'feat-greet-sub', 'feat-shout-sub', 'src/greet.js', 'src/shout.js', 'hello ada', 'HELLO ADA']) expect(text).toContain(word);
});
test('stack tasks specify branches and the dependent greeting behavior', () => {
  const text = prompt('autopilot-stack');
  for (const word of ['reserved', 'feat-greet-stack', 'feat-shout-stack', 'src/greet.js', 'src/shout.js', 'hello ada', 'HELLO ADA']) expect(text).toContain(word);
});
