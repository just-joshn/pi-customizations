import { formatName } from './format.js';

export function greet() {
  return `hello, ${formatName('world')}`;
}
