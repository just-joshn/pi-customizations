import { message } from './core.js';

export function greet(opts) {
  const text = message();
  return opts?.shout ? text.toUpperCase() : text;
}
