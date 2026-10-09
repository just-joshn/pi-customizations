import { createStore } from './store.js';
import { formatNote } from './format.js';

const store = createStore();
for (const note of store.list()) {
  console.log(formatNote(note));
}
