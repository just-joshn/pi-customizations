#!/usr/bin/env node
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const mode = process.argv[2] || 'both';
const { runIndexer, runMetrics, report } = await import(
  `${pathToFileURL(join(root, 'src', 'workers.js')).href}?t=${Date.now()}`
);

if (mode === 'indexer') {
  console.log(JSON.stringify(await runIndexer(root, process.argv[3] || 'idx-1')));
} else if (mode === 'metrics') {
  console.log(JSON.stringify(await runMetrics(root, process.argv[3] || 'met-1')));
} else {
  await Promise.all([
    runIndexer(root, process.argv[3] || 'idx-1'),
    runMetrics(root, process.argv[4] || 'met-1'),
  ]);
  console.log(JSON.stringify(await report(root)));
}
