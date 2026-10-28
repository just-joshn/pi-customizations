import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { expect, test } from 'vitest';
import { editOptionList } from '../../src/edit/options.ts';
import { gitOptionList } from '../../src/git/options.ts';
import { lintOptionList } from '../../src/lint/options.ts';
import { mapOptionList } from '../../src/map/options.ts';
import { settingsOptions } from '../../src/settings/options.ts';

const root = join(import.meta.dirname, '..', '..');
const captured: { aiderCommit: string; options: string[] } = JSON.parse(readFileSync(join(root, 'parity/options.aider.json'), 'utf8'));
const inventory: { aiderCommit: string; options: Record<string, { registered?: string; nonclaim?: string; reason?: string }> } = JSON.parse(readFileSync(join(root, 'parity/options.json'), 'utf8'));

const registeredSpellings = new Set([...editOptionList, ...gitOptionList, ...mapOptionList, ...lintOptionList, ...Object.values(settingsOptions)].flatMap((spec) => [spec.name, ...spec.aliases, ...spec.constFlags.map((flag) => flag.name)]));

const NONCLAIMS = new Set(['pi-owned', 'out-of-scope', 'not-ported']);

test('every Aider option has exactly one disposition', () => {
  expect(inventory.aiderCommit).toBe(captured.aiderCommit);
  expect(Object.keys(inventory.options).sort()).toEqual([...captured.options].sort());
});

test('every registered option names a spelling the extension registers', () => {
  for (const [option, disposition] of Object.entries(inventory.options)) {
    if (disposition.registered === undefined) continue;
    expect(registeredSpellings.has(disposition.registered), `${option} -> ${disposition.registered}`).toBe(true);
  }
});

test('nonclaimed options carry a category and a reason', () => {
  for (const [option, disposition] of Object.entries(inventory.options)) {
    if (disposition.registered !== undefined) continue;
    expect(NONCLAIMS.has(disposition.nonclaim ?? ''), option).toBe(true);
    expect((disposition.reason ?? '').length, option).toBeGreaterThan(20);
  }
});

test('the weak model and chat-history budget options are registered', () => {
  expect(inventory.options['--weak-model']).toEqual({ registered: 'weak-model' });
  expect(inventory.options['--max-chat-history-tokens']).toEqual({ registered: 'max-chat-history-tokens' });
  expect(editOptionList.map((spec) => spec.name)).toContain('weak-model');
  expect(editOptionList.map((spec) => spec.name)).toContain('max-chat-history-tokens');
});
