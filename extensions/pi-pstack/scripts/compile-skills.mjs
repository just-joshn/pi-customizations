#!/usr/bin/env node
import { chmodSync, copyFileSync, mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import { compile } from '../adapters/skill-transforms.ts';

const { values } = parseArgs({ options: { root: { type: 'string' } } });
const root = resolve(values.root ?? join(dirname(fileURLToPath(import.meta.url)), '..'));
try {
  const result = compile(root);
  for (const dir of ['generated/skills', 'generated/agents', 'generated/prompts', 'generated/automations']) rmSync(join(root, dir), { recursive: true, force: true });
  for (const output of result.outputs) {
    const target = join(root, output.path);
    mkdirSync(dirname(target), { recursive: true });
    if (output.source && output.text === undefined) copyFileSync(join(root, output.source), target);
    else writeFileSync(target, output.text);
    if (output.source) chmodSync(target, statSync(join(root, output.source)).mode & 0o777);
  }
  writeFileSync(join(root, 'generated/transformation-manifest.json'), `${JSON.stringify(result.manifest, null, 2)}\n`);
  console.log(`compiled ${result.manifest.counts.skills} skills, ${result.manifest.counts.agents} agents, ${result.manifest.counts.prompts} prompts; ${result.manifest.counts.rules} rules, ${result.manifest.counts.spans} spans`);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
