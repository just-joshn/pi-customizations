import { fileURLToPath } from 'node:url';
import { createStore } from './store.js';
import { formatNote } from './format.js';

const file = fileURLToPath(new URL('../notes.json', import.meta.url));
const store = createStore({ file });
for (const { text, createdAt } of store.entries()) {
  console.log(formatNote(text, createdAt));
}
