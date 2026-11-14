import { writeFileSync } from 'node:fs';

const out = process.argv[2];
const queries = ['\x1b]10;?\x07', '\x1b]11;?\x07', ...Array.from({ length: 16 }, (_, i) => `\x1b]4;${i};?\x07`)];
process.stdin.setRawMode(true);
let buf = '';
process.stdin.on('data', (d) => {
  buf += d.toString('latin1');
});
process.stdout.write(queries.join(''));
setTimeout(() => {
  const rgb = (s) => {
    const m = s.match(/rgb:([0-9a-f]+)\/([0-9a-f]+)\/([0-9a-f]+)/i);
    return m
      ? '#' +
          m
            .slice(1)
            .map((h) => h.slice(0, 2))
            .join('')
            .toLowerCase()
      : null;
  };
  const replies = buf.split(/\x07|\x1b\\/).filter(Boolean);
  const res = { foreground_rgb: null, background_rgb: null, ansi16_rgb: Array(16).fill(null), raw: buf };
  for (const r of replies) {
    const fg = r.match(/\]10;(.*)/);
    const bg = r.match(/\]11;(.*)/);
    const indexed = r.match(/\]4;(\d+);(.*)/);
    if (fg) res.foreground_rgb = rgb(fg[1]);
    else if (bg) res.background_rgb = rgb(bg[1]);
    else if (indexed) res.ansi16_rgb[+indexed[1]] = rgb(indexed[2]);
  }
  res.columns = process.stdout.columns;
  res.rows = process.stdout.rows;
  writeFileSync(out, JSON.stringify(res, null, 2));
  process.exit(0);
}, 1500);
