import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const defaultPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'notes.json');

function normalizeNote(entry) {
  if (typeof entry === 'string') {
    return { text: entry, createdAt: new Date().toISOString() };
  }
  return {
    text: String(entry.text),
    createdAt: String(entry.createdAt ?? new Date().toISOString()),
  };
}

function writeNotes(path, notes) {
  writeFileSync(path, `${JSON.stringify(notes, null, 2)}\n`, 'utf8');
}

export function createStore(seed = ['alpha', 'beta'], path = defaultPath) {
  let notes;
  if (existsSync(path)) {
    const raw = JSON.parse(readFileSync(path, 'utf8'));
    notes = Array.isArray(raw) ? raw.map(normalizeNote) : [];
  } else {
    notes = seed.map((text) => normalizeNote(text));
    writeNotes(path, notes);
  }

  return {
    list() {
      return notes.map((note) => ({ ...note }));
    },
    add(text) {
      notes = [...notes, normalizeNote(text)];
      writeNotes(path, notes);
      return notes.length;
    },
  };
}
