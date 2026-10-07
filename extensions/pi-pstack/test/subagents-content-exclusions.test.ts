import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { expect, test } from 'vitest';
import { parseContentExclusions } from '../src/subagents/content-exclusion.ts';
import { workerFixture } from './worker-fixture.ts';

const secret = 'PSTACK_SECRET=present';

test('both settings placements merge into one deduplicated list', () => {
  expect(parseContentExclusions({ contentExclusions: ['.env', 'secrets/**'], subagents: { contentExclusions: ['.env', '*.pem'] } })).toEqual({ patterns: ['.env', 'secrets/**', '*.pem'], problems: [] });
});

test('absent or non-object settings carry no exclusions and no problems', () => {
  for (const settings of [undefined, null, 'text', 7, []]) expect(parseContentExclusions(settings)).toEqual({ patterns: [], problems: [] });
});

test('every malformed placement is reported by name', () => {
  expect(parseContentExclusions({ contentExclusions: [''], subagents: { contentExclusions: 7 } })).toEqual({
    patterns: [],
    problems: ['contentExclusions must be an array of non-empty strings', 'subagents.contentExclusions must be an array of non-empty strings'],
  });
});
type ToolResult = { toolName: string; isError: boolean; content: { text: string }[] };

async function excludedRead(settings: Readonly<Record<string, unknown>>): Promise<readonly ToolResult[]> {
  const fixture = await workerFixture({ settings });
  try {
    await writeFile(join(fixture.dir, '.env'), `${secret}\n`);
    await fixture.call('task', { agent_type: 'general-purpose', name: 'excluded', description: 'exclusion probe', prompt: 'READ_EXCLUDED', mode: 'sync' });
    return JSON.parse(await readFile(join(fixture.dir, 'child-tool-results.json'), 'utf8')) as ToolResult[];
  } finally {
    await fixture.close();
  }
}

test.for([
  { name: 'at the top level', settings: { contentExclusions: ['.env'] } },
  { name: 'under the subagents key', settings: { subagents: { contentExclusions: ['.env'] } } },
  { name: 'in both places', settings: { contentExclusions: ['.env'], subagents: { contentExclusions: ['.env'] } } },
])('an excluded file read is blocked when contentExclusions is $name', async ({ settings }) => {
  const results = await excludedRead(settings);
  const read = results.find((result) => result.toolName === 'read');
  expect(read?.content.map((block) => block.text).join('\n')).toContain('blocked by the content exclusion policy');
  expect(JSON.stringify(results)).not.toContain(secret);
});

test.for([
  { name: 'a string at the top level', settings: { contentExclusions: '.env' } },
  { name: 'a list with an empty string', settings: { contentExclusions: [''] } },
  { name: 'numbers under the subagents key', settings: { subagents: { contentExclusions: [7] } } },
])('a malformed exclusion setting ($name) refuses to start the child', async ({ settings }) => {
  const fixture = await workerFixture({ settings });
  try {
    await expect(fixture.call('task', { agent_type: 'general-purpose', name: 'excluded', description: 'exclusion probe', prompt: 'READ_EXCLUDED', mode: 'sync' })).rejects.toThrow('contentExclusions');
  } finally {
    await fixture.close();
  }
});
