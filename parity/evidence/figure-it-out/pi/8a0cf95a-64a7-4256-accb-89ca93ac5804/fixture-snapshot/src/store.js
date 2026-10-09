import { existsSync, readFileSync, writeFileSync } from 'node:fs';

function load(file, seed) {
  if (existsSync(file)) {
    return JSON.parse(readFileSync(file, 'utf8'));
  }
  const createdAt = new Date().toISOString();
  const entries = seed.map((text) => ({ text, createdAt }));
  writeFileSync(file, `${JSON.stringify(entries, null, 2)}\n`);
  return entries;
}

export function createStore({ file, seed = ['alpha', 'beta'] } = {}) {
  let entries = file ? load(file, seed) : seed.map((text) => ({ text, createdAt: new Date().toISOString() }));
  return {
    list() {
      return entries.map((entry) => entry.text);
    },
    entries() {
      return entries.map((entry) => ({ ...entry }));
    },
    add(text) {
      entries = [...entries, { text: String(text), createdAt: new Date().toISOString() }];
      if (file) {
        writeFileSync(file, `${JSON.stringify(entries, null, 2)}\n`);
      }
      return entries.length;
    },
  };
}
