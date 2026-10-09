/**
 * Session TTL helpers.
 * Contract: ttl === 0 means never expire (immortal session).
 * Positive ttl is milliseconds after createdAt.
 */
export function isExpired(entry, now) {
  if (entry.ttl === 0) return false;
  return entry.createdAt + entry.ttl <= now;
}

export function purge(entries, now) {
  return entries.filter((entry) => !isExpired(entry, now));
}
