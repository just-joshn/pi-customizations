#!/usr/bin/env node
// Compares the success-flow write card between Cursor and Pi screen dumps.
// Contract from the reference host edit card (setup-prepair cursor screen-04):
// title line `Edited pstack-models.mdc +N -M`, then ▎-gutter context with a
// removed budget line and an added budget line. No `Wrote … with budget` form.
//
// Usage: node scripts/compare-write-card.mjs <cursorScreenDump> <piScreenDump>
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

const strip = (line) => line.replace(/\u001b\[[0-9;?]*[A-Za-z]/g, '').replace(/\u001b\]8;;\u0007/g, '');
const gutter = (line) => strip(line).replace(/[┃│]\s*$/, '').replace(/\s+$/, '');

function writeCardFindings(lines) {
  const findings = [];
  const plain = lines.map(gutter);
  const titles = plain.filter((text) => /Edited pstack-models\.mdc \+\d+ -\d+/.test(text.trim()));
  findings.push({ check: 'edited-title', pass: titles.length >= 1, observed: titles[0]?.trim() ?? null });
  const wrote = plain.filter((text) => /Wrote .+ with budget /.test(text));
  findings.push({ check: 'no-wrote-form', pass: wrote.length === 0, observed: wrote.length });
  const removed = plain.filter((text) => /▎-\s*# budget:/.test(text));
  const added = plain.filter((text) => /▎\+\s*# budget:/.test(text));
  findings.push({ check: 'diff-removed-budget', pass: removed.length >= 1, observed: removed[0]?.trim() ?? null });
  findings.push({ check: 'diff-added-budget', pass: added.length >= 1, observed: added[0]?.trim() ?? null });
  const context = plain.filter((text) => /▎\s{2}.+inherit-parent/.test(text));
  findings.push({ check: 'diff-context-role', pass: context.length >= 1, observed: context[0]?.trim() ?? null });
  return findings;
}

const [cursorPath, piPath, outPath] = process.argv.slice(2);
if (!cursorPath || !piPath) {
  console.error('usage: compare-write-card.mjs <cursorScreenDump> <piScreenDump> [reportJson]');
  process.exit(2);
}
const cursorLines = (await readFile(cursorPath, 'utf8')).split('\n');
const piLines = (await readFile(piPath, 'utf8')).split('\n');
const report = {
  schema: 1,
  comparator: 'write-card-v1',
  sides: {
    cursor: writeCardFindings(cursorLines),
    pi: writeCardFindings(piLines),
  },
};
const failures = [];
for (const side of ['cursor', 'pi']) {
  for (const finding of report.sides[side]) {
    if (!finding.pass) failures.push(`${side}:${finding.check}=${JSON.stringify(finding.observed)}`);
  }
}
report.pass = failures.length === 0;
report.failures = failures;
const json = `${JSON.stringify(report, null, 2)}\n`;
process.stdout.write(json);
if (outPath) {
  await writeFile(outPath, json);
} else {
  await writeFile(join(dirname(piPath), '..', 'write-card-parity.json'), json);
}
process.exitCode = report.pass ? 0 : 1;
