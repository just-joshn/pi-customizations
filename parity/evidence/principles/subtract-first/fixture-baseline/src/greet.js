import { message } from './core.js';
import { legacyValidate } from './legacyValidate.js';
import { unusedStubHook } from './stubRefs.js';

// Dead imports kept warm so verify can see them. No shout yet.
void legacyValidate;
void unusedStubHook;

export function greet(_opts) {
  return message();
}
