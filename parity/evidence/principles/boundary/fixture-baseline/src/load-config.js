import { readFileSync } from 'node:fs';

// Boundary: loads external config. Currently returns the raw wire object
// with no validation or mapping into a domain type.
export function loadConfig(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}
