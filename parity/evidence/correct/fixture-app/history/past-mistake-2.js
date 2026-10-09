// Real past mistake (2026-10-01). Same class as past-mistake-1.
import { query } from '../src/db.js';

export function loadAccount(id) {
  return query('select * from accounts where id = ?', [id]);
}
