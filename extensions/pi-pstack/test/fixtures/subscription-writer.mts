import { appendFileSync, writeFileSync } from 'node:fs';

import { acceptEvent, acquireLease, cancelDesired, createDesired, deliverOwner, readRegistry } from '../../src/subscriptions/durable-store.ts';

const [cwd, operation, value, marker] = process.argv.slice(2);
if (cwd === undefined || value === undefined) throw new Error('Missing fixture arguments.');
if (operation === 'hold') {
  const lease = acquireLease(value);
  if (lease === undefined || marker === undefined) throw new Error('Could not acquire fixture lock.');
  writeFileSync(marker, lease.token);
  setInterval(() => {}, 1_000);
} else if (operation === 'accept') {
  process.stdout.write(acceptEvent(cwd, 'sub-aaaa', value, 'accepted in producer'));
} else if (operation === 'cancel') {
  process.stdout.write(JSON.stringify(cancelDesired(cwd, value)));
} else if (operation === 'deliver') {
  deliverOwner(
    cwd,
    'owner',
    () => true,
    (_sub, event) => appendFileSync(value, `${event.id}\n`),
  );
} else {
  const now = Date.now();
  const result = createDesired(cwd, {
    id: `sub-${value}-${process.pid}`,
    name: value,
    createdAt: now,
    expiresAt: now + 60_000,
    ownerSessionId: 'fixture-owner',
    config: { kind: 'timer', prompt: value, delaySeconds: 10, once: true, strategy: 'wake_self' },
  });
  process.stdout.write(JSON.stringify({ created: result.created, count: readRegistry(cwd).subscriptions.length }));
}
