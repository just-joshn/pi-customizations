import { readDisplayName } from './config.js';

export function greet() {
  const cfg = { displayName: 'world' };
  const name = readDisplayName(cfg);
  return `hello, ${name.toUpperCase()}`;
}
