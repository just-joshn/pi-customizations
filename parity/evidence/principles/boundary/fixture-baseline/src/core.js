// Business logic. Today it re-validates the wire shape mid-call-chain and
// also expects a domain `name` field the boundary never produces.
export function formatGreeting(cfg) {
  if (!cfg || typeof cfg.displayName !== 'string' || !cfg.displayName.trim()) {
    throw new Error('invalid displayName');
  }
  if (typeof cfg.name !== 'string' || !cfg.name.trim()) {
    throw new Error('missing domain name');
  }
  return `hello, ${cfg.name.toUpperCase()}`;
}
