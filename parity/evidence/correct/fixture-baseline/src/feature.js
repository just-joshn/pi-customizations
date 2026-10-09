import { getUser } from './store.js';

export function loadProfile(id) {
  return getUser(id);
}
