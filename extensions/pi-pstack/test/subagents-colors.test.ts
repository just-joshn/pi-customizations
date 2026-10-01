import { expect, test } from 'vitest';
import { parseAgentFile } from '../src/subagents/definitions.ts';
import { parseJsonAgents } from '../src/subagents/json-definitions.ts';

const colors = ['red', 'blue', 'green', 'yellow', 'purple', 'orange', 'pink', 'cyan'];

test.for(colors)('[G2-27] frontmatter color %s is retained', (color) => {
  expect(parseAgentFile('/p/a.md', `---\nname: colored\ndescription: Colored\ncolor: ${color}\n---\nTask`, 'userSettings', '/p').agent?.color).toBe(color);
});

test.for(['RED', 'gray', '#ff0000', 'auto'])('[G2-27] unsupported frontmatter color %s is omitted', (color) => {
  expect(parseAgentFile('/p/a.md', `---\nname: colored\ndescription: Colored\ncolor: ${color}\n---\nTask`, 'userSettings', '/p').agent).not.toHaveProperty('color');
});

test.for([...colors, 'RED', 'gray', null, 12])('[G2-05] JSON color %s is stripped as an unknown source field', (color) => {
  expect(parseJsonAgents(JSON.stringify({ colored: { description: 'Colored', prompt: 'Task', color } }), '/p')).toEqual([{ agentType: 'colored', whenToUse: 'Colored', systemPrompt: 'Task', source: 'flagSettings', baseDir: '/p' }]);
});
