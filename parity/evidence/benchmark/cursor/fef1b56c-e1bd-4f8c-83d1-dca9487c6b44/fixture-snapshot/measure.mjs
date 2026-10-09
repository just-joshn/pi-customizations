#!/usr/bin/env node
// One-run ballpark timer. Writes run-evidence.json for checklist Q4/Q7.
import { writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const N = 5000;

function sortSlow(arr) {
  const a = arr.slice();
  for (let i = 0; i < a.length; i++) {
    for (let j = i + 1; j < a.length; j++) {
      if (a[j] < a[i]) {
        const t = a[i];
        a[i] = a[j];
        a[j] = t;
      }
    }
  }
  return a;
}

function sortFast(arr) {
  return arr.slice().sort((x, y) => x - y);
}

function makeInput() {
  const out = new Array(N);
  for (let i = 0; i < N; i++) out[i] = (i * 17 + 3) % 9973;
  return out;
}

function isSorted(arr) {
  for (let i = 1; i < arr.length; i++) {
    if (arr[i] < arr[i - 1]) return false;
  }
  return true;
}

const input = makeInput();
let errors = 0;

const t0 = performance.now();
const slow = sortSlow(input);
const t1 = performance.now();
const fast = sortFast(input);
const t2 = performance.now();

if (!isSorted(slow)) errors += 1;
if (!isSorted(fast)) errors += 1;
if (slow.length !== N || fast.length !== N) errors += 1;

const slowMs = t1 - t0;
const fastMs = t2 - t1;
const speedupPct = slowMs > 0 ? ((slowMs - fastMs) / slowMs) * 100 : null;

const evidence = {
  runCount: 1,
  n: N,
  slowMs,
  fastMs,
  speedupPct,
  errorCount: errors,
  outputsCorrect: errors === 0,
  workHappened: slow.length === N && fast.length === N && isSorted(slow) && isSorted(fast),
  timedRegion: 'sortSlow then sortFast over the same input array',
};

writeFileSync(join(root, 'run-evidence.json'), `${JSON.stringify(evidence, null, 2)}\n`);
console.log(JSON.stringify(evidence));
