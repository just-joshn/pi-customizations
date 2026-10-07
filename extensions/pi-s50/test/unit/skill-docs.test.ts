import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, test } from 'vitest';
import { decode } from '../../src/orchestrator/decode.ts';
import { command } from '../../src/orchestrator/schema.ts';

const REFERENCES = fileURLToPath(new URL('../../skills/s50/references/', import.meta.url));

function jsonExamples(): readonly (readonly [string, string])[] {
  return readdirSync(REFERENCES).flatMap((file) => {
    const blocks = [...readFileSync(join(REFERENCES, file), 'utf8').matchAll(/```json\n([\s\S]*?)```/g)];
    return blocks.flatMap((block) =>
      (block[1] ?? '')
        .split('\n')
        .filter((line) => line.trim() !== '')
        .map((line) => [file, line] as const),
    );
  });
}

test('the skill references show at least one command per file', () => {
  expect(new Set(jsonExamples().map(([file]) => file))).toEqual(new Set(['bug.md', 'feature.md', 'frontend.md', 'verification.md']));
});

test.for(jsonExamples())('%s example decodes as a command: %s', ([, line]) => {
  expect(decode(command, JSON.parse(line)).kind).toBe('ok');
});
