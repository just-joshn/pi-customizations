import { purge } from './ttl.js';

/** Drop expired sessions before persist. Immortal sessions use ttl: 0. */
export function retainLive(sessions, now) {
  return purge(sessions, now);
}
