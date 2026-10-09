/**
 * Sketch: one-shot corpus inventory lever.
 * Target path at fill-in: scripts/inventory.mjs
 * No new modules; no package exports.
 */

import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const corpusDir = join(root, 'corpus');
const summaryPath = join(root, 'out', 'summary.json');

/** @type {RegExp} */
const MARKER_RE = /MARKER-[A-Z0-9]+/g;

/**
 * Walk corpusDir, extract unique MARKER-* tokens from every file.
 * @param {string} dir
 * @returns {Promise<string[]>} alphabetical unique markers
 */
export async function collectMarkers(dir) {
  throw new Error('not implemented');
}

/**
 * Write {"markers": string[]} to path (mkdir parent as needed).
 * @param {string} path
 * @param {string[]} markers sorted unique
 * @returns {Promise<void>}
 */
export async function writeSummary(path, markers) {
  throw new Error('not implemented');
}

/**
 * Inventory corpus/ → out/summary.json. CLI entry.
 * @returns {Promise<void>}
 */
export async function main() {
  throw new Error('not implemented');
  // intended body:
  // const markers = await collectMarkers(corpusDir);
  // await writeSummary(summaryPath, markers);
  // console.log(`wrote ${markers.length} markers to out/summary.json`);
}

// at fill-in (when this file lives at scripts/inventory.mjs):
// await main();
