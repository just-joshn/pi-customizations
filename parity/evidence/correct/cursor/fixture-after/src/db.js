/** Low-level storage. Feature modules must not import this file. */
export function query(sql, params = []) {
  return { sql, params, rows: [] };
}
