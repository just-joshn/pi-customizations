#!/usr/bin/env node
import { defaultContext, runCli } from './commands.ts';

try {
  const result = await runCli(process.argv.slice(2), defaultContext(process.cwd()));
  process.stdout.write(result.stdout);
  process.exitCode = result.code;
} catch (error) {
  process.stderr.write(`s50: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
