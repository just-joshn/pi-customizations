import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, test } from 'vitest';

const root = fileURLToPath(new URL('../', import.meta.url));
const read = (path: string) => readFile(join(root, path), 'utf8');

test('the goal skill is not model-invocable', async () => {
  const goal = await read('host/skills/goal/SKILL.md');
  expect(goal).toMatch(/^---\nname: goal\ndescription: .+\ndisable-model-invocation: true\n---\n/);
});

test('the goal skill uses one durable flow in local and cloud environments', async () => {
  const goal = await read('host/skills/goal/SKILL.md');
  expect(goal).toContain('Use the same durable, tool-driven flow in local and cloud environments.');
});

test('the goal skill passes playbook-supplied goal text to CreateGoal verbatim', async () => {
  const goal = await read('host/skills/goal/SKILL.md');
  expect(goal).toContain('When a playbook supplies exact goal text, pass it to `CreateGoal` verbatim and restate the objective only in your reply.');
});

test('the loop skill adapts loop syntax to the user shell', async () => {
  const loop = await read('host/skills/loop/SKILL.md');
  expect(loop).toContain("Adapt loop syntax to the user's shell (for example PowerShell `while ($true) { ... Start-Sleep }` on Windows). The examples here use bash.");
});

test('the loop skill prefers monitored shell output over OS cron for wakes', async () => {
  const loop = await read('host/skills/loop/SKILL.md');
  expect(loop).toContain('Prefer monitored shell output over OS cron when the agent needs wake notifications; stdout stays attached to the monitored task.');
});

test('the loop skill titles every loop shell, watcher, and heartbeat', async () => {
  const loop = await read('host/skills/loop/SKILL.md');
  expect(loop).toContain('Title every loop shell, watcher, and heartbeat `Loop <schedule>: <prompt>`');
  expect(loop).toContain('title `Loop every <interval>: <prompt>`');
});

test('the loop skill forbids duplicate fixed loops and dynamic sleepers', async () => {
  const loop = await read('host/skills/loop/SKILL.md');
  expect(loop).toContain('Do not create duplicate fixed loops or dynamic sleepers.');
});

test('the loop skill acts on output wakes over completion notices', async () => {
  const loop = await read('host/skills/loop/SKILL.md');
  expect(loop).toContain('If both an output wake and a shell completion notification arrive, act on the output and ignore the completion.');
});

test('the loop skill reports changes on later ticks', async () => {
  const loop = await read('host/skills/loop/SKILL.md');
  expect(loop).toContain('On later ticks, give a short update of what changed.');
});

test('the loop skill stops when a named exit predicate passes', async () => {
  const loop = await read('host/skills/loop/SKILL.md');
  expect(loop).toContain('If the prompt names an exit predicate such as `until done` or `until CI is green`, evaluate it at the start of every tick and stop the loop when it passes instead of running the prompt again.');
  expect(loop).toContain('use `/goal` (`CreateGoal`) and let `/loop` supply only the wake');
});

test('create-skill restores the complete worked example', async () => {
  const skill = await read('host/skills/create-skill/SKILL.md');
  expect(skill).toContain('## Complete Example');
  expect(skill).toContain("Here's a complete example of a well-structured skill:");
  expect(skill).toContain('├── STANDARDS.md');
  expect(skill).toContain('name: code-review');
  expect(skill).toContain('## Review Checklist');
  expect(skill).toContain('## Providing Feedback');
  expect(skill).toContain('- **Critical**: Must fix before merge');
  expect(skill).toContain('- For detailed coding standards, see [STANDARDS.md](STANDARDS.md)');
  expect(skill).toContain('- For example reviews, see [examples.md](examples.md)');
});

test('create-skill keeps the test and description loops beside the example', async () => {
  const skill = await read('host/skills/create-skill/SKILL.md');
  expect(skill).toContain('## Draft, test, and iterate');
  expect(skill).toContain('## Optimize a description');
});

test('create-skill accepts imperative trigger clauses in descriptions', async () => {
  const skill = await read('host/skills/create-skill/SKILL.md');
  expect(skill).toContain('The ban is on first and second person. An imperative trigger clause such as `Use when ...`, `Use for ...`, or `Apply when ...` is the WHEN half and is accepted.');
});

test('no bundled skill description is written in first or second person', async () => {
  const offenders: string[] = [];
  for (const base of ['skills', 'host/skills']) {
    for (const { name } of (await readdir(join(root, base), { withFileTypes: true })).filter((entry) => entry.isDirectory())) {
      const text = await read(`${base}/${name}/SKILL.md`);
      const description = /^description:\s*(?:>-?\n((?: {2}.+\n)+)|(.+))$/m.exec(text);
      const value = (description?.[1] ?? description?.[2] ?? '').replace(/\s+/g, ' ');
      if (/\b(I can|You can|I will|you can use this)\b/i.test(value)) offenders.push(`${base}/${name}`);
    }
  }
  expect(offenders.join('\n')).toBe('');
});
