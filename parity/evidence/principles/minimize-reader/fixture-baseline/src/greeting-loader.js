import { fetchGreeting } from './greeting-fetch.js';

// One-caller pass-through. Same args, no abstraction change.
export function loadGreeting() {
  return fetchGreeting();
}
