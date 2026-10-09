/**
 * Candidate 1 sketch — src/inventory.mjs public API.
 * Bodies throw until Phase D fill-in.
 *
 * CLI (scripts/inventory.mjs) is not part of this module:
 *   const summary = await inventoryMarkers(corpusDir);
 *   await writeSummary(summary, outPath);
 */

/**
 * Unique, alphabetically sorted MARKER-* tokens from a corpus tree.
 *
 * @typedef {object} MarkerSummary
 * @property {string[]} markers
 */

/**
 * Scan every file under corpusDir for MARKER-* tokens.
 * Owns match pattern, uniqueness, and alphabetical order.
 *
 * @param {string} corpusDir
 * @returns {Promise<MarkerSummary>}
 */
export async function inventoryMarkers(corpusDir) {
  void corpusDir;
  throw new Error('not implemented');
}

/**
 * Persist a MarkerSummary as {"markers":[...]} JSON at outPath.
 * Creates parent directories as needed.
 *
 * @param {MarkerSummary} summary
 * @param {string} outPath
 * @returns {Promise<void>}
 */
export async function writeSummary(summary, outPath) {
  void summary;
  void outPath;
  throw new Error('not implemented');
}
