import { query } from './db.js';

/** Supported data access path for feature modules. */
export function getUser(id) {
  return query('select * from users where id = ?', [id]);
}
