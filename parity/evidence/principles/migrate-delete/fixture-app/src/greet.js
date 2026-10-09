import { formatNameLegacy } from './legacyFormat.js';

export function greet() {
  return `hello, ${formatNameLegacy('world')}`;
}
