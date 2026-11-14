import { readdirSync, readFileSync } from 'node:fs';

import { attrList, resolve } from '../lib/align.ts';
import { parseCapture } from '../lib/sgr.ts';

const base = new URL('../', import.meta.url).pathname;
const palette = JSON.parse(readFileSync(`${base}captures/terminal-palette.json`, 'utf8'));
const styles = (dir: string, f: string) =>
  new Set(
    parseCapture(readFileSync(`${base}captures/${dir}/${f}`, 'utf8'))
      .filter((r) => r.text.trim() || r.style.bg.kind !== 'default')
      .map((r) => `${resolve(r.style.fg, 'fg', palette)}|${resolve(r.style.bg, 'bg', palette)}|${attrList(r.style)}`),
  );
const [a, b] = process.argv.slice(2);
if (!a || !b) throw new Error('usage: node scripts/style-sets.ts <capture-dir> <capture-dir>');
let same = 0;
for (const f of readdirSync(`${base}captures/${a}`)
  .filter((f) => f.endsWith('.ansi'))
  .sort()) {
  const x = styles(a, f),
    y = styles(b, f);
  const onlyA = [...x].filter((s) => !y.has(s)),
    onlyB = [...y].filter((s) => !x.has(s));
  if (onlyA.length || onlyB.length) console.log(f, `${a} only`, JSON.stringify(onlyA), `${b} only`, JSON.stringify(onlyB));
  else same++;
}
console.log('identical style sets:', same);
