import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

async function loadJson(path) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch {
    return {};
  }
}

async function saveJson(root, relPath, data) {
  await mkdir(join(root, 'state'), { recursive: true });
  await writeFile(join(root, relPath), `${JSON.stringify(data)}\n`);
}

export async function runIndexer(root, value) {
  const relPath = 'state/indexer.json';
  const state = await loadJson(join(root, relPath));
  await new Promise((r) => setTimeout(r, 8));
  state.lastIndexed = value;
  await saveJson(root, relPath, state);
  return state;
}

export async function runMetrics(root, value) {
  const relPath = 'state/metrics.json';
  const state = await loadJson(join(root, relPath));
  await new Promise((r) => setTimeout(r, 8));
  state.lastMetrics = value;
  await saveJson(root, relPath, state);
  return state;
}

export async function report(root) {
  const indexer = await loadJson(join(root, 'state/indexer.json'));
  const metrics = await loadJson(join(root, 'state/metrics.json'));
  return {
    lastIndexed: indexer.lastIndexed,
    lastMetrics: metrics.lastMetrics,
  };
}
