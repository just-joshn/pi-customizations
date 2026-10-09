#!/usr/bin/env node
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outPath = join(root, 'evidence', 'verify-out.txt');
const stateDir = join(root, 'state');
const workersPath = join(root, 'src', 'workers.js');

async function loadWorkers() {
  return import(`${pathToFileURL(workersPath).href}?t=${Date.now()}`);
}

async function cleanState() {
  await rm(stateDir, { force: true, recursive: true });
  await mkdir(stateDir, { recursive: true });
}

export function analyzeWorkersSource(src) {
  const indexerBlock = src.match(/export async function runIndexer[\s\S]*?(?=export async function|$)/)?.[0] || '';
  const metricsBlock = src.match(/export async function runMetrics[\s\S]*?(?=export async function|$)/)?.[0] || '';
  const reportBlock = src.match(/export async function report[\s\S]*?(?=export async function|$)/)?.[0] || '';

  const fileRefs = (block) => {
    const hits = [...block.matchAll(/['"`]([^'"`]*state\/[^'"`]+\.json)['"`]/g)].map((m) => m[1]);
    return [...new Set(hits)];
  };

  const indexerFiles = fileRefs(indexerBlock);
  const metricsFiles = fileRefs(metricsBlock);
  const reportFiles = fileRefs(reportBlock);
  const overlap = indexerFiles.filter((f) => metricsFiles.includes(f));
  const separated =
    indexerFiles.length >= 1 &&
    metricsFiles.length >= 1 &&
    overlap.length === 0 &&
    !indexerFiles.includes('state/state.json') &&
    !metricsFiles.includes('state/state.json');
  const stillShared = !separated;
  const reportMerges =
    /lastIndexed/.test(reportBlock) &&
    /lastMetrics/.test(reportBlock) &&
    (reportFiles.length >= 2 ||
      (separated &&
        indexerFiles.every((f) => reportBlock.includes(f.split('/').pop())) &&
        metricsFiles.every((f) => reportBlock.includes(f.split('/').pop()))));

  return {
    indexerFiles,
    metricsFiles,
    reportFiles,
    overlap,
    separated,
    stillShared,
    reportMerges,
  };
}

let line = 'SEPARATE-FAIL reason=unknown';
let ok = false;

try {
  const src = await readFile(workersPath, 'utf8');
  const analysis = analyzeWorkersSource(src);
  const { runIndexer, runMetrics, report } = await loadWorkers();

  await cleanState();
  await Promise.all([runIndexer(root, 'idx-A'), runMetrics(root, 'met-B')]);
  const once = await report(root);

  await cleanState();
  let last = null;
  for (let i = 0; i < 6; i++) {
    await Promise.all([runIndexer(root, `idx-${i}`), runMetrics(root, `met-${i}`)]);
    last = await report(root);
  }
  const bothPresent =
    last &&
    typeof last.lastIndexed === 'string' &&
    typeof last.lastMetrics === 'string' &&
    last.lastIndexed.startsWith('idx-') &&
    last.lastMetrics.startsWith('met-');

  const onceOk = once && once.lastIndexed === 'idx-A' && once.lastMetrics === 'met-B';

  if (analysis.stillShared) {
    line = `SEPARATE-FAIL reason=still-shared indexer=${JSON.stringify(analysis.indexerFiles)} metrics=${JSON.stringify(analysis.metricsFiles)}`;
  } else if (!analysis.reportMerges) {
    line = 'SEPARATE-FAIL reason=report-does-not-merge-owned-targets';
  } else if (!onceOk || !bothPresent) {
    line = `SEPARATE-FAIL reason=lost-update once=${JSON.stringify(once)} last=${JSON.stringify(last)}`;
  } else {
    ok = true;
    line = `SEPARATE-OK separated=yes indexer=${analysis.indexerFiles.join(',')} metrics=${analysis.metricsFiles.join(',')} lastIndexed=${last.lastIndexed} lastMetrics=${last.lastMetrics}`;
  }
} catch (e) {
  line = `SEPARATE-FAIL reason=exception error=${e instanceof Error ? e.message : String(e)}`;
}

await mkdir(dirname(outPath), { recursive: true });
await writeFile(outPath, `${line}\n`);
console.log(line);
process.exit(ok ? 0 : 1);
