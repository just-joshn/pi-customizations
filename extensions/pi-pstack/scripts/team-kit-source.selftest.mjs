import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { teamKitRecords, teamKitSource } from './team-kit-source.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const records = await teamKitRecords(root);
const inventory = JSON.parse(await readFile(new URL('../docs/team-kit-source-inventory.json', import.meta.url), 'utf8'));
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
for (const record of records) {
  const entry = inventory.find((candidate) => candidate.path === record.path);
  const adapted = Buffer.from(record.adapted);
  assert.deepEqual(teamKitSource(entry, adapted, records), adapted);
  const drift = Buffer.concat([adapted, Buffer.from('\n')]);
  assert.throws(() => teamKitSource(entry, drift, records), /adapted source mismatch/);
  assert.throws(() => teamKitSource({ ...entry, sha256: sha(drift) }, drift, records), /canonical source mismatch/);
  const forged = records.map((candidate) => (candidate === record ? { ...candidate, original: candidate.adapted } : candidate));
  assert.throws(() => teamKitSource(entry, adapted, forged), /canonical source mismatch/);
}
const untouched = inventory.find((entry) => !records.some((record) => record.path === entry.path));
assert.throws(() => teamKitSource(untouched, Buffer.from('unrecorded drift'), records), /Upstream hash mismatch/);
process.stdout.write('Team-kit replay rejects live drift, inventory rebaselines, forged originals and unrecorded drift.\n');
