import { readFile } from 'node:fs/promises';

import { expect, test } from 'vitest';
import { fixture, prompt } from './session-fixture.ts';

const root = new URL('../', import.meta.url);
const text = (path: string) => readFile(new URL(path, root), 'utf8');

test.for(['correct', 'benchmark-checklist', 'principle-explain-the-number', 'poteto-help'])('latest workflow %s has a native skill and prompt alias', async (name) => {
  expect(await text(`skills/${name}/SKILL.md`)).toContain(`name: ${name}`);
  expect(await text(`prompts/${name}.md`)).toContain(`Read ${name}/SKILL.md in full`);
});

test.for([
  { name: 'correct', evidence: 'A class counts once it has happened twice.' },
  { name: 'benchmark-checklist', evidence: 'Why not double?' },
  { name: 'principle-explain-the-number', evidence: 'A measured number is a claim about a system.' },
  { name: 'poteto-help', evidence: "Answer the user's question about pstack, hand them a prompt they can send" },
])('$name expands through native skill invocation and the prompt read path', async ({ name, evidence }) => {
  const f = await fixture();
  try {
    const { session, loader } = await f.open();
    const skill = loader.getSkills().skills.find((entry) => entry.name === name);
    expect(skill?.disableModelInvocation).toBe(true);
    await prompt(session, `/skill:${name} Check this workspace.`);
    expect(JSON.stringify(f.requests.at(-1)?.messages)).toContain(evidence);
    f.calls.push({ type: 'toolCall', id: `read-${name}`, name: 'read', arguments: { path: skill?.filePath ?? '' } });
    await prompt(session, `/${name} Preserve the original request.`);
    const request = JSON.stringify(f.requests.at(-1)?.messages);
    expect(request).toContain(evidence);
    expect(request).toContain('Preserve the original request.');
    expect(f.errors).toEqual([]);
  } finally {
    await f.close();
  }
});

test('new work gets fresh agents while costly live state permits reuse', async () => {
  const mode = await text('skills/poteto-mode/SKILL.md');
  expect(mode).toContain('Fresh subagents by default.');
  expect(mode).toContain('the original brief, every later directive, and the prior agent');
  expect(mode).toContain('its uncommitted changes');
  expect(mode).toContain('A stop or hold order to a running agent is not reuse.');
});

test.for(['autopilot-full', 'autopilot-stack'])('%s audits hourly without a stale goal or wake chain', async (name) => {
  const playbook = await text(`skills/poteto-mode/playbooks/${name}.md`);
  expect(playbook).toContain('/loop 1h');
  expect(playbook).toContain('after every verifiable unit');
  expect(playbook).not.toMatch(/30.minute|cloud-sleeper|armed .?\/goal/);
});

test('PR instructions prefer an available native tool and keep scope separate from changes', async () => {
  const playbook = await text('skills/poteto-mode/playbooks/opening-a-pr.md');
  expect(playbook).toContain('## What changed');
  expect(playbook).toContain('## Scope');
  expect(playbook).toContain('deliberately leaves out');
  expect(playbook).toContain('When the run provides a built-in PR tool');
  expect(playbook).toContain('draft: false');
});

test('performance workflows vet numbers and schema guidance validates whole values', async () => {
  expect(await text('skills/poteto-mode/playbooks/perf-issue.md')).toContain('benchmark-checklist');
  expect(await text('skills/poteto-mode/playbooks/hillclimb.md')).toContain('error count and a count of the work done');
  expect(await text('skills/typescript-best-practices/references/patterns.md')).toContain('const userSchema: z.ZodType<User> = z.object({ id: z.string(), name: z.string() });');
});

test('poteto-help names the Pi install, the sticky mode, and the next-turn model rule', async () => {
  const help = await text('skills/poteto-help/SKILL.md');
  expect(help).toContain('pi install ./extensions/pi-pstack');
  expect(help).toContain('`/poteto-mode off`');
  expect(help).toContain('The rule applies from the next turn.');
  for (const absent of ['/add-plugin', 'Custom Mode', 'Option+Enter', 'cursor.com/docs', "Reference's"]) expect(help).not.toContain(absent);
});
