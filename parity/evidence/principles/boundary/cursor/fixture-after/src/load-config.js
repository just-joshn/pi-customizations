import { readFileSync } from 'node:fs';

export function loadConfig(path) {
  const wire = JSON.parse(readFileSync(path, 'utf8'));
  if (!wire || typeof wire.displayName !== 'string' || !wire.displayName.trim()) {
    throw new Error('invalid displayName');
  }
  return { name: wire.displayName.trim() };
}
