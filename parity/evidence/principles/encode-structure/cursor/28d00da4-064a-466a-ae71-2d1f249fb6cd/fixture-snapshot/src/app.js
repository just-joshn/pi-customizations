import { readFlags } from './config.js';

export function bootLabel() {
  const flags = readFlags();
  return flags.ALLOW_DEBUG ? 'debug-on' : 'debug-off';
}
