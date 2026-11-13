import { expect, test } from 'vitest';
import { autopilotFamilies, bodyHasSections } from './families/pr-autopilot.ts';
import { shippingFamily } from './families/pr-shipping.ts';
import type { RunView } from './lib/view.ts';

test('shipping does not demand both example control skills for a module', () => {
  expect(shippingFamily.checks.some((entry) => entry.id === 'reads.shipping.named-skills')).toBe(false);
  const read = shippingFamily.checks.find((entry) => entry.id === 'reads.shipping.poteto-mode-and-playbook')!;
  expect(read.run({ parent: { messages: [], toolCalls: [] } } as unknown as RunView)).toMatchObject({ ok: false });
});
test('autopilot still requires the root swarm skill, not owner-side deslop or example control skills', () => {
  const family = autopilotFamilies.find((entry) => entry.id === 'autopilot-full')!;
  const check = family.checks.find((entry) => entry.id === 'reads.autopilot-full.named-skills')!;
  const view = (names: string[]) => ({ parent: { messages: [], toolCalls: names.map((name, order) => ({ order, name: 'read', args: { path: `/generated/skills/${name}/SKILL.md` } })) } }) as unknown as RunView;
  expect(check.run(view(['swarm', 'show-me-your-work', 'ketchup']))).toMatchObject({ ok: true });
  expect(check.run(view(['show-me-your-work', 'ketchup']))).toMatchObject({ ok: false });
});
test('an empty optional Blast Radius section can be omitted but Scope cannot', () => {
  const body = '## Why\nA change.\n## What changed\nA module.\n## Scope\nOne file.\n## Verification\nTests.';
  expect(bodyHasSections(body)).toEqual([]);
  expect(bodyHasSections(body.replace('## Scope', '## Other'))).toContain('lacks ## Scope');
});
