import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ttlPath = fileURLToPath(new URL('./src/ttl.js', import.meta.url));
const storePath = fileURLToPath(new URL('./src/sessionStore.js', import.meta.url));
const diffPath = fileURLToPath(new URL('./CHANGE.diff', import.meta.url));
const originalTtl = readFileSync(ttlPath, 'utf8');
const storeSrc = readFileSync(storePath, 'utf8');
const diff = readFileSync(diffPath, 'utf8');

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

assert(
  storeSrc.includes('Immortal sessions use ttl: 0'),
  'sessionStore must document ttl:0 as immortal',
);
assert(
  /Immortal sessions use ttl: 0/.test(storeSrc) &&
    /return purge\(sessions, now\)/.test(storeSrc),
  'retainLive must purge while documenting immortal ttl:0',
);
assert(
  diff.includes('if (entry.ttl === 0) return true;'),
  'CHANGE.diff must flip ttl===0 to expired',
);
assert(
  originalTtl.includes('if (entry.ttl === 0) return false;'),
  'current ttl.js must treat ttl===0 as immortal',
);

const childScript = `
import { retainLive } from './src/sessionStore.js';
const immortal = { id: 'immortal', ttl: 0, createdAt: 0 };
const now = 1_000_000_000_000;
const kept = retainLive([immortal], now);
console.log(JSON.stringify(kept));
`;

function runRetainLive() {
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', childScript], {
    cwd: fileURLToPath(new URL('.', import.meta.url)),
    encoding: 'utf8',
  });
  if (r.status !== 0) {
    throw new Error(`child failed: ${r.stderr || r.stdout}`);
  }
  return JSON.parse(r.stdout.trim());
}

const keptBefore = runRetainLive();
assert(
  keptBefore.length === 1 && keptBefore[0].id === 'immortal',
  `before change immortal must survive; got ${JSON.stringify(keptBefore)}`,
);
console.log('BEFORE: retainLive keeps ttl:0 immortal →', keptBefore);

const changedTtl = originalTtl
  .replace(
    ' * Contract: ttl === 0 means never expire (immortal session).',
    ' * Contract: ttl === 0 means already dead (zero remaining life).',
  )
  .replace(
    '  if (entry.ttl === 0) return false;',
    '  if (entry.ttl === 0) return true;',
  );
assert(changedTtl !== originalTtl, 'failed to apply CHANGE.diff semantics to ttl.js');
assert(
  changedTtl.includes('if (entry.ttl === 0) return true;'),
  'patched ttl.js must match CHANGE.diff',
);

writeFileSync(ttlPath, changedTtl);
try {
  const keptAfter = runRetainLive();
  assert(
    keptAfter.length === 0,
    `after change immortal must be purged; got ${JSON.stringify(keptAfter)}`,
  );
  console.log('AFTER:  retainLive drops ttl:0 immortal →', keptAfter);
  console.log(
    'PROOF: change is UNSAFE — sessionStore.retainLive documents ttl:0 as immortal and calls purge; CHANGE.diff makes isExpired(ttl:0)=true so immortal sessions are deleted before persist',
  );
} finally {
  writeFileSync(ttlPath, originalTtl);
}

const restored = readFileSync(ttlPath, 'utf8');
assert(restored === originalTtl, 'ttl.js must be restored after proof');
