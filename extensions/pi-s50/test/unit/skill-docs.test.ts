import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, test } from 'vitest';
import type { Phase } from '../../src/domain/state.ts';
import { PHASES } from '../../src/domain/state.ts';
import { decode } from '../../src/orchestrator/decode.ts';
import { command } from '../../src/orchestrator/schema.ts';
import { isLegalTransition } from '../../src/orchestrator/transitions.ts';

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

function diagramEdges(): readonly (readonly [string, string])[] {
  const text = readFileSync(join(REFERENCES, 'feature.md'), 'utf8');
  const blocks = [...text.matchAll(/```\n([\s\S]*?)```/g)].map((block) => block[1] ?? '').filter((block) => block.includes(' -> '));
  return blocks.flatMap((block) =>
    block
      .split('\n')
      .filter((line) => line.includes(' -> '))
      .flatMap((line) => {
        const steps = line.split(' -> ').map((step) => step.split(' | ').map((phase) => phase.trim()));
        return steps.slice(1).flatMap((targets, index) => (steps[index] ?? []).flatMap((from) => targets.map((to) => [from, to] as const)));
      }),
  );
}

const asPhase = (name: string): Phase | undefined => PHASES.find((phase) => phase === name);

test.for(diagramEdges())('feature.md edge %s -> %s is legal', ([from, to]) => {
  const source = asPhase(from);
  const target = asPhase(to);
  expect(source !== undefined && target !== undefined && isLegalTransition(source, target)).toBe(true);
});
