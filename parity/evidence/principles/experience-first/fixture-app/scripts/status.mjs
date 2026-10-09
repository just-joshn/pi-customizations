#!/usr/bin/env node
import { formatStatus, sampleState } from '../src/status.js';

const json = process.argv.includes('--json');
process.stdout.write(`${formatStatus(sampleState(), { json })}\n`);
