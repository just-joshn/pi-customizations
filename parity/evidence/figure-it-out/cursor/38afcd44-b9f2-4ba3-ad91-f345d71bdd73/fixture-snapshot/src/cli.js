import { createStore } from './store.js';
import { formatNote } from './format.js';

const store = createStore();
const notes = store.list();
for (const note of notes) {
  console.log(formatNote(note));
}
