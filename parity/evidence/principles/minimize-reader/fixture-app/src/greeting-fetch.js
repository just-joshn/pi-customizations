import { resolveGreeting } from './greeting-resolve.js';

// One-caller pass-through. Same args, no abstraction change.
export function fetchGreeting() {
  return resolveGreeting();
}
