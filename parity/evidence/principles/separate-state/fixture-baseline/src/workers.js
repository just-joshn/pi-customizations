import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * Two workers publish independent facts. Intentionally both read-modify-write
 * the same state/state.json, so concurrent runs lose one worker's update.
 */
async function loadShared(root) {
  try {
    return JSON.parse(await readFile(join(root, 'state/state.json'), 'utf8'));
  } catch {
    return {};
  }
}

async function saveShared(root, data) {
  await mkdir(join(root, 'state'), { recursive: true });
  await writeFile(join(root, 'state/state.json'), `${JSON.stringify(data)}\n`);
}

export async function runIndexer(root, value) {
  const state = await loadShared(root);
  await new Promise((r) => setTimeout(r, 8));
  state.lastIndexed = value;
  await writeFile(join(root, 'state/state.json'), `${JSON.stringify(state)}\n`);
  return state;
}

export async function runMetrics(root, value) {
  const state = await loadShared(root);
  await new Promise((r) => setTimeout(r, 8));
  state.lastMetrics = value;
  await writeFile(join(root, 'state/state.json'), `${JSON.stringify(state)}\n`);
  return state;
}

export async function report(root) {
  return loadShared(root);
}
