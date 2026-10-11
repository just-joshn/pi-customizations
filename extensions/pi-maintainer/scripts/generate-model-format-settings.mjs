#!/usr/bin/env node
// Extract format-related fields from Aider's packaged model-settings.yml into JSON.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parse } from 'yaml';

const root = fileURLToPath(new URL('..', import.meta.url));
const aiderRoot = process.env.AIDER_CHECKOUT ?? process.env.AIDER_MODEL_SETTINGS;
if (!aiderRoot) {
  process.stderr.write('Set AIDER_CHECKOUT (repo root) or AIDER_MODEL_SETTINGS (yml path)\n');
  process.exit(1);
}
const aiderSettings = aiderRoot.endsWith('.yml') || aiderRoot.endsWith('.yaml') ? aiderRoot : join(aiderRoot, 'aider/resources/model-settings.yml');
const out = join(root, 'src/edit/model-format-settings.json');
const keys = ['edit_format', 'editor_edit_format', 'examples_as_sys_msg', 'reminder'];
const list = parse(readFileSync(aiderSettings, 'utf8'), { uniqueKeys: false });
const slim = [];
for (const entry of list) {
  const row = { name: entry.name };
  let hit = false;
  for (const key of keys) {
    if (entry[key] != null) {
      row[key] = entry[key];
      hit = true;
    }
  }
  if (hit) slim.push(row);
}
writeFileSync(out, `${JSON.stringify(slim, null, 2)}\n`);
process.stdout.write(`wrote ${slim.length} entries to ${out}\n`);
