import { message } from './core.js';

// One-caller pass-through. Same args, no abstraction change.
export function resolveGreeting() {
  return message();
}
