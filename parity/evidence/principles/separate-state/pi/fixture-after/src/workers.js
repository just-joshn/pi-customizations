import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

async function load(root, file) {
  try {
    return JSON.parse(await readFile(join(root, file), 'utf8'));
  } catch {
    return {};
  }
}

async function save(root, file, data) {
  await mkdir(join(root, 'state'), { recursive: true });
  await writeFile(join(root, file), `${JSON.stringify(data)}\n`);
}

export async function runIndexer(root, value) {
  const state = { ...(await load(root, 'state/indexer-state.json')), lastIndexed: value };
  await new Promise((r) => setTimeout(r, 8));
  await save(root, 'state/indexer-state.json', state);
  return state;
}

export async function runMetrics(root, value) {
  const state = { ...(await load(root, 'state/metrics-state.json')), lastMetrics: value };
  await new Promise((r) => setTimeout(r, 8));
  await save(root, 'state/metrics-state.json', state);
  return state;
}

export async function report(root) {
  const indexer = await load(root, 'state/indexer-state.json');
  const metrics = await load(root, 'state/metrics-state.json');
  return { lastIndexed: indexer.lastIndexed, lastMetrics: metrics.lastMetrics };
}
