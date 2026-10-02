import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseFrontmatter } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';
import { Check } from 'typebox/value';

export const triggerNames = ['user.message', 'session.context_changed', 'session.memory_changed'] as const;
export type TriggerName = (typeof triggerNames)[number];
export type SidekickSpec = Readonly<{
  name: string;
  description: string;
  prompt: string;
  featureFlag: string;
  behavior: 'persistent' | 'restart';
  triggers: Readonly<Partial<Record<TriggerName, number>>>;
  cancelOnNewTurn: boolean;
  maxSendsPerTurn: number;
  inlineForwardMaxChars: number;
  launchConditions: readonly string[];
  tools: readonly string[];
}>;

const Frontmatter = Type.Object({
  name: Type.String({ minLength: 1 }),
  description: Type.String({ minLength: 1 }),
  featureFlag: Type.String({ minLength: 1 }),
  behavior: Type.Union([Type.Literal('persistent'), Type.Literal('restart')]),
  triggers: Type.Record(Type.String(), Type.Integer({ minimum: 1 })),
  cancelOnNewTurn: Type.Boolean(),
  maxSendsPerTurn: Type.Integer({ minimum: 1 }),
  inlineForwardMaxChars: Type.Integer({ minimum: 1 }),
  launchConditions: Type.Array(Type.String()),
  tools: Type.Array(Type.String()),
});

export const sidekickDirectory = fileURLToPath(new URL('./definitions/', import.meta.url));

export function parseSidekick(text: string, path: string): { spec?: SidekickSpec; error?: string } {
  const { frontmatter, body } = parseFrontmatter<Record<string, unknown>>(text);
  if (!Check(Frontmatter, frontmatter)) return { error: `Failed to parse sidekick ${path}: the frontmatter is missing or invalid fields.` };
  const entries = Object.entries(frontmatter.triggers);
  const unknown = entries.find(([name]) => !triggerNames.some((known) => known === name));
  if (unknown) return { error: `Failed to parse sidekick ${path}: unknown trigger ${unknown[0]}.` };
  const triggers = Object.fromEntries(entries.flatMap(([name, limit]) => triggerNames.filter((known) => known === name).map((known) => [known, limit])));
  return { spec: { ...frontmatter, triggers, prompt: body.trim() } };
}

export function loadSidekicks(directory: string = sidekickDirectory): { specs: readonly SidekickSpec[]; errors: readonly string[] } {
  const parsed = readdirSync(directory)
    .filter((name) => name.endsWith('.md'))
    .toSorted()
    .map((name) => parseSidekick(readFileSync(join(directory, name), 'utf8'), name));
  return { specs: parsed.flatMap((entry) => (entry.spec ? [entry.spec] : [])), errors: parsed.flatMap((entry) => (entry.error ? [entry.error] : [])) };
}
