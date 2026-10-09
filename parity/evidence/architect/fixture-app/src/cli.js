#!/usr/bin/env node
// CLI entry. Ownership: argv parsing and printing API results.
import { create, list } from './api.js';

const [cmd, ...rest] = process.argv.slice(2);

if (cmd === 'list') {
  console.log(JSON.stringify(list()));
} else if (cmd === 'create') {
  console.log(JSON.stringify(create({ title: rest.join(' ') })));
} else {
  console.error('usage: cli.js list|create <title>');
  process.exit(1);
}
