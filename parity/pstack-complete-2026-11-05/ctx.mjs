#!/usr/bin/env node
// Usage: ctx.mjs <needle> <width> <max> <file...>
// Prints up to <max> excerpts of <width> characters on each side of every occurrence of <needle> in each file.
import { readFileSync } from 'node:fs';

const [needle, width = '200', max = '5', ...files] = process.argv.slice(2);
for (const file of files) {
  const text = readFileSync(file, 'utf8');
  let from = 0;
  let count = 0;
  let index = text.indexOf(needle, from);
  while (index !== -1 && count < Number(max)) {
    const start = Math.max(0, index - Number(width));
    console.log(`--- ${file}@${index}\n${text.slice(start, index + needle.length + Number(width))}`);
    count++;
    from = index + needle.length;
    index = text.indexOf(needle, from);
  }
}
