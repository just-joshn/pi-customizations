import { message } from './core.js';

export function greet({ shout = false } = {}) {
  const text = message();
  return shout ? text.toUpperCase() : text;
}
