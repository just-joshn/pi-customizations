#!/usr/bin/env node
// Compares the post-escape transcript card contract between the two sides of a
// cancellation pair. The reference contract (captured in the cursor dumps): exactly
// one collapsed AskQuestion card line whose title is left-aligned and whose skip
// label is right-aligned, question blocks below rendered unchecked, and no raw tool
// internals (no pstack card lines, no JSON echo).
//
// Usage: node scripts/compare-cancel-card.mjs <cursorScreenDump> <piScreenDump>
import { readFile } from 'node:fs/promises';

const strip = (line) => line.replace(/\u001b\[[0-9;?]*[A-Za-z]/g, '').replace(/\u001b\]8;;\u0007/g, '');
const gutter = (line) => strip(line).replace(/[┃│]\s*$/, '').replace(/\s+$/, '');

function cardFindings(lines) {
  const findings = [];
  const cardLines = lines.map((raw, index) => [index, gutter(raw)]).filter(([, text]) => /^AskQuestion .+\(\d+\)/.test(text.trim()));
  findings.push({ check: 'exactly-one-card-line', pass: cardLines.length === 1, observed: cardLines.length });
  const header = cardLines[0]?.[1] ?? '';
  findings.push({ check: 'skip-label-right-aligned', pass: header.length > 0 && header.trimEnd().endsWith('Questions skipped by user'), observed: header.trimEnd().slice(-40) });
  findings.push({ check: 'title-before-label', pass: /^(AskQuestion .+\(\d+\)).+Questions skipped by user$/.test(header.trim()), observed: header.trim().slice(0, 60) });
  const cardIndex = cardLines[0]?.[0] ?? -1;
  const blocks = lines.slice(cardIndex + 1).map(gutter);
  const checked = blocks.filter((text) => /\[x\]/.test(text));
  findings.push({ check: 'blocks-unchecked', pass: checked.length === 0, observed: checked.length });
  const unchecked = blocks.filter((text) => /\[ \] /.test(text));
  findings.push({ check: 'blocks-present', pass: unchecked.length > 0, observed: unchecked.length });
  const rawEcho = lines.map(gutter).filter((text) => /questions=\[\{|"cancelled":true|"answers":\[\]/.test(text));
  findings.push({ check: 'no-json-echo', pass: rawEcho.length === 0, observed: rawEcho.length });
  const pstackCards = lines.map(gutter).filter((text) => /pstack setup — /.test(text));
  findings.push({ check: 'no-setup-tool-cards', pass: pstackCards.length === 0, observed: pstackCards.length });
  return findings;
}

const [cursorPath, piPath] = process.argv.slice(2);
if (!cursorPath || !piPath) {
  console.error('usage: compare-cancel-card.mjs <cursorScreenDump> <piScreenDump>');
  process.exit(2);
}
const cursorLines = (await readFile(cursorPath, 'utf8')).split('\n');
const piLines = (await readFile(piPath, 'utf8')).split('\n');
const report = {
  schema: 1,
  comparator: 'cancel-card-v1',
  sides: {
    cursor: cardFindings(cursorLines),
    pi: cardFindings(piLines),
  },
};
const failures = [];
for (const side of ['cursor', 'pi']) {
  for (const finding of report.sides[side]) {
    if (!finding.pass) failures.push(`${side}:${finding.check}=${finding.observed}`);
  }
}
report.pass = failures.length === 0;
report.failures = failures;
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
process.exitCode = report.pass ? 0 : 1;