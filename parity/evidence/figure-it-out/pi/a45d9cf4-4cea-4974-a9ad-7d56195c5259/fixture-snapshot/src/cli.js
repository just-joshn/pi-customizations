import { fileURLToPath } from 'node:url';
import { createStore } from './store.js';
import { formatNote } from './format.js';

const notesFile = fileURLToPath(new URL('../notes.json', import.meta.url));
const store = createStore(undefined, notesFile);
for (const note of store.list()) {
  console.log(formatNote(note));
}
