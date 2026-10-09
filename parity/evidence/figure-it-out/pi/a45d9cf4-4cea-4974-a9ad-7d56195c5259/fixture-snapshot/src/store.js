import { existsSync, readFileSync, writeFileSync } from 'node:fs';

export function createStore(seed = ['alpha', 'beta'], file = null) {
  let notes;
  if (file && existsSync(file)) {
    notes = JSON.parse(readFileSync(file, 'utf8'));
  } else {
    const now = new Date().toISOString();
    notes = seed.map((text) => ({ text, createdAt: now }));
  }
  const save = () => {
    if (file) writeFileSync(file, JSON.stringify(notes, null, 2) + '\n');
  };
  save();
  return {
    list() {
      return notes.map((n) => ({ ...n }));
    },
    add(text) {
      notes = [...notes, { text: String(text), createdAt: new Date().toISOString() }];
      save();
      return notes.length;
    },
  };
}
