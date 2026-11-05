#!/usr/bin/env node
// Usage: classify-adaptations.mjs <plugins-checkout> <pi-pstack-dir> <tree-diff.json> <out.json>
// Splits every changed reference file into diff hunks and labels each hunk by the Cursor-specific text it removes.
// A hunk that removes no Cursor-specific text, or only adds text, is "review" and must be judged by hand.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const [plugins, pi, treeDiff, out] = process.argv.slice(2);
const HOST_TOKENS = [
  ['path', /~\/\.cursor|\.cursor\/|\.cursor-plugin|agent-transcripts|plugins\/cache|mcps\/|@cursor-skill|\.mdc\b|pstack\/skills\/|`pstack\/|cursor\/plugins\/blob/],
  ['model-syntax', /-(?:xhigh|high|medium|max)(?:-fast)?\b|-fast\b|fast or standard speed/],
  [
    'host-product',
    /\bCursor\b|cursor-team-kit|cursor team kit|cursor automations?|Automations?\b|\/automate\b|\/add-plugin|Grok Bot|update_state|SendToUser|api2\.cursor\.sh|Routines|computer preview|in-app browser|Custom Mode|Option\+Enter|Alt\+Enter|Use as Mode|Agents Window|cloud agents?|Cloud Agent|cloud-agent|\bVM\b|\bVMs\b|Claude Code|claude code|\/plugin\b/i,
  ],
  ['tool-names', /\bRead, Grep, and Glob\b|\bShell, Grep\b|`Read` of|agent mode|readonly\/Ask mode|readonly: false\) \(agent mode\)|\(agent mode\)|Ask mode/],
];
const rows = JSON.parse(readFileSync(treeDiff, 'utf8')).rows.filter((row) => row.status === 'changed');
const hunks = [];
for (const row of rows) {
  let diff = '';
  try {
    diff = execFileSync('diff', ['-U0', join(plugins, row.plugin, row.file), join(pi, row.target)], { encoding: 'utf8' });
  } catch (error) {
    diff = error.stdout;
  }
  for (const hunk of diff.split(/\n(?=@@ )/).filter((part) => part.startsWith('@@ '))) {
    const lines = hunk.split('\n');
    const removed = lines.filter((line) => line.startsWith('-') && !line.startsWith('---')).map((line) => line.slice(1));
    const added = lines.filter((line) => line.startsWith('+') && !line.startsWith('+++')).map((line) => line.slice(1));
    const labels = HOST_TOKENS.filter(([, pattern]) => removed.some((line) => pattern.test(line))).map(([label]) => label);
    hunks.push({
      file: `${row.plugin}/${row.file}`,
      header: lines[0],
      labels: labels.length > 0 ? labels : ['review'],
      removed,
      added,
    });
  }
}
const byLabel = {};
for (const hunk of hunks) for (const label of hunk.labels) byLabel[label] = (byLabel[label] ?? 0) + 1;
writeFileSync(out, `${JSON.stringify({ files: rows.length, hunkCount: hunks.length, byLabel, hunks }, null, 2)}\n`);
console.log(JSON.stringify({ files: rows.length, hunkCount: hunks.length, byLabel }));
for (const hunk of hunks.filter((h) => h.labels.includes('review'))) console.log(`REVIEW ${hunk.file} ${hunk.header} -${hunk.removed.length} +${hunk.added.length}`);
