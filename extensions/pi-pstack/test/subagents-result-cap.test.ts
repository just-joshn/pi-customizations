import { readFile } from 'node:fs/promises';

import { expect, test } from 'vitest';
import { resultText } from '../src/subagents/results.ts';
import { workerFixture } from './worker-fixture.ts';

test('[G1-07] unexpected Agent result status has the exact failure message', () => {
  expect(() => resultText({ status: 'zzz' } as never)).toThrow('Unexpected agent tool result status: zzz');
});

test('[G1-07] real foreground Agent caps the full child output at 100000 characters', async () => {
  const fixture = await workerFixture();
  try {
    const result = await fixture.call('Agent', { description: 'large result', prompt: 'LARGE_RESULT', run_in_background: false });
    const details = result.details as { agentId: string; content: { text: string }[] };
    expect(result.details).toHaveProperty('usage');
    expect(result.details).toHaveProperty('totalDurationMs');
    expect(result.details).toHaveProperty('totalTokens');
    expect(details.content[0]?.text.length).toBe(100000);
    expect(details.content[0]?.text).toBe('x'.repeat(100000));
    const output = await fixture.call('TaskOutput', { task_id: details.agentId });
    const record = output.details as { output: string; outputFile: string };
    expect(record.output.length).toBe(12000);
    expect(await readFile(record.outputFile, 'utf8')).toBe('x'.repeat(100001));
  } finally {
    await fixture.close();
  }
});
