#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const policy = fileURLToPath(new URL('./bind-git-policy-rows.mjs', import.meta.url));
const run = spawnSync(process.execPath, [policy], { stdio: 'inherit' });
process.exit(run.status ?? 1);
