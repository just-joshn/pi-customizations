// Real past mistake (2026-09-12). Feature code imported db directly.
import { query } from '../src/db.js';

export function loadProfile(id) {
  return query('select * from users where id = ?', [id]);
}
