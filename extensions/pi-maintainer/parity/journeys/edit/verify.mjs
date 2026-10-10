import { fileURLToPath } from 'node:url';

import { artifactsRoot } from './host.mjs';
import { runPrintJourney } from './run-print.mjs';
import { runRpcJourney } from './run-rpc.mjs';

async function main() {
  const print = await runPrintJourney();
  process.stdout.write(`ok print exit=${print.exitCode} artifact=${print.artifactPath}\n`);
  const rpc = await runRpcJourney();
  process.stdout.write(`ok rpc exit=${rpc.exitCode} artifact=${rpc.artifactPath}\n`);
  process.stdout.write(`artifacts dir ${artifactsRoot}\n`);
  process.stdout.write('edit journeys passed\n');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await main();
}
